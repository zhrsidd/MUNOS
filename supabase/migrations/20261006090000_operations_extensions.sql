-- Conference operations extensions (Claude-owned) — resolution submission around Google Docs.
-- CODEX REVIEW REQUIRED. See docs/OPERATIONS_EXTENSIONS.md.
--
-- Product rule: Google Docs is the resolution editor. Conference OS tracks the workflow AROUND the
-- document (who submitted it, when, its working Google Doc, whether the Chair sent it to Approval).
-- Conference OS never reads, parses or edits document text.
--
-- Additive only: no existing table, policy or function is altered.
--  * public.submission_links: one active, unguessable link per committee (+ "share edit access with" email).
--  * public.resolution_links: per resolution, the working Google Doc id, an optional Approval-folder copy id,
--    and the Chair's access check (unchecked / ok / problem). Staff read via RLS.
--  * private.resolution_submissions: idempotency, duplicate detection and rate limiting for
--    unauthenticated delegate submissions. No browser access.
--  * public.operations_snapshot(conf): RLS-respecting read of extension data, merged by the client.
--  * public.apply_operations_mutation(...): same idempotent outbox contract as apply_conference_mutation.
--  * public.submission_link_info / public.submit_resolution: callable ONLY by service_role
--    (the server route holding SUPABASE_SECRET_KEY). Never granted to anon or authenticated.
--  * Storage bucket "resolutions" (private): ONLY for the optional file-upload fallback and future
--    snapshots. It is not the authoritative resolution; the working Google Doc is.

create table public.submission_links (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 token text not null unique check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
 -- Who delegates share their Google Doc with (normally the committee's Chair account).
 share_with text not null default '' check (length(share_with) <= 200),
 created_by uuid references auth.users(id), revoked_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), foreign key (committee_id, conference_id) references public.committees(id, conference_id)
);
create unique index submission_links_one_active on public.submission_links(committee_id) where revoked_at is null;
create index submission_links_conference_idx on public.submission_links(conference_id);
alter table public.submission_links enable row level security;
revoke all on public.submission_links from anon, authenticated;
grant select on public.submission_links to authenticated;
create policy read_authorized on public.submission_links for select to authenticated
 using (private.has_access(conference_id, committee_id, array['admin','chair']::public.conference_role[]));

create table public.resolution_links (
 document_id uuid primary key, conference_id uuid not null references public.conferences(id), committee_id uuid not null,
 working_doc_id text check (working_doc_id ~ '^[A-Za-z0-9_-]{25,100}$'),
 approval_copy_doc_id text check (approval_copy_doc_id ~ '^[A-Za-z0-9_-]{25,100}$'),
 access text not null default 'unchecked' check (access in ('unchecked','ok','problem')),
 submitted_at timestamptz, -- set when a delegate submitted through the committee link
 revision bigint not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key (document_id, conference_id, committee_id) references public.documents(id, conference_id, committee_id),
 foreign key (committee_id, conference_id) references public.committees(id, conference_id)
);
create index resolution_links_conference_idx on public.resolution_links(conference_id);
create index resolution_links_committee_idx on public.resolution_links(committee_id);
alter table public.resolution_links enable row level security;
revoke all on public.resolution_links from anon, authenticated;
grant select on public.resolution_links to authenticated;
create policy read_authorized on public.resolution_links for select to authenticated
 using (private.has_access(conference_id, committee_id, array['admin','chair','approval','logistics','observer']::public.conference_role[]));

create table private.resolution_submissions (
 id uuid primary key, conference_id uuid not null references public.conferences(id),
 committee_id uuid not null, link_id uuid not null references public.submission_links(id),
 document_id uuid not null references public.documents(id),
 google_doc_id text check (google_doc_id ~ '^[A-Za-z0-9_-]{25,100}$'),
 file_sha256 text check (file_sha256 ~ '^[0-9a-f]{64}$'), file_size integer check (file_size > 0),
 created_at timestamptz not null default now(),
 check ((google_doc_id is null) <> (file_sha256 is null))
);
create index resolution_submissions_doc on private.resolution_submissions(committee_id, google_doc_id);
create index resolution_submissions_file on private.resolution_submissions(committee_id, file_sha256);
create index resolution_submissions_rate on private.resolution_submissions(link_id, created_at desc);
create index resolution_submissions_document on private.resolution_submissions(document_id);
alter table private.resolution_submissions enable row level security;

create function private.uuid_or_null(value text) returns uuid language sql immutable set search_path='' as $$
 select case when value ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then value::uuid end;
$$;
revoke all on function private.uuid_or_null(text) from public, anon;
grant execute on function private.uuid_or_null(text) to authenticated;

-- Extension read model. SECURITY INVOKER: table RLS decides what each caller sees.
create function public.operations_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'submissionLinks', (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'committeeId',l.committee_id,'token',l.token,'shareWith',l.share_with,'createdAt',l.created_at) order by l.created_at, l.id),'[]')
    from public.submission_links l where l.conference_id = conf and l.revoked_at is null),
  'resolutionLinks', (select coalesce(jsonb_agg(jsonb_build_object('documentId',r.document_id,'workingDocId',r.working_doc_id,'approvalCopyDocId',r.approval_copy_doc_id,'access',r.access,'submittedAt',r.submitted_at,'revision',r.revision) order by r.created_at, r.document_id),'[]')
    from public.resolution_links r where r.conference_id = conf)
 );
$$;
revoke all on function public.operations_snapshot(uuid) from public, anon;
grant execute on function public.operations_snapshot(uuid) to authenticated;

-- Handlers run inside private.apply_operations_mutation (SECURITY DEFINER) and are not callable directly.
create function private.ops_submission_link(conf uuid, cid uuid, actor uuid, new_id uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare active uuid;
begin
 if command->>'action' = 'shareWith' then
   -- Change who delegates share with, without replacing the QR code.
   update public.submission_links set share_with = left(coalesce(command->>'shareWith',''),200), updated_at = now()
   where committee_id = cid and revoked_at is null returning id into active;
   if active is null then raise exception 'No active submission link' using errcode='22023'; end if;
   return active;
 end if;
 -- create and rotate both replace the active link; revoke only retires it.
 update public.submission_links set revoked_at = now(), updated_at = now() where committee_id = cid and revoked_at is null;
 if command->>'action' in ('create','rotate') then
   insert into public.submission_links(id, conference_id, committee_id, token, share_with, created_by)
   values (new_id, conf, cid, command->>'token', left(coalesce(command->>'shareWith',''),200), actor);
   return new_id;
 elsif command->>'action' <> 'revoke' then raise exception 'Unknown link action' using errcode='22023';
 end if;
 return cid;
end; $$;
revoke all on function private.ops_submission_link(uuid,uuid,uuid,uuid,jsonb) from public, anon, authenticated;

-- Chair bookkeeping around the Google Doc: link the working doc, record the Approval-folder copy,
-- and mark whether the Chair can open it. No Google API calls; ids only.
create function private.ops_resolution_link(conf uuid, cid uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare doc uuid := private.uuid_or_null(command->>'documentId'); value text := nullif(command->>'docId','');
begin
 if command->>'action' = 'access' then
   if command->>'access' not in ('unchecked','ok','problem') then raise exception 'Unknown access state' using errcode='22023'; end if;
   insert into public.resolution_links(document_id, conference_id, committee_id, access) values (doc, conf, cid, command->>'access')
   on conflict (document_id) do update set access = excluded.access, revision = resolution_links.revision + 1, updated_at = now();
 elsif command->>'action' = 'approvalCopy' then
   insert into public.resolution_links(document_id, conference_id, committee_id, approval_copy_doc_id) values (doc, conf, cid, value)
   on conflict (document_id) do update set approval_copy_doc_id = excluded.approval_copy_doc_id, revision = resolution_links.revision + 1, updated_at = now();
 elsif command->>'action' = 'workingDoc' then
   if value is null then raise exception 'A Google Doc is required' using errcode='22023'; end if;
   insert into public.resolution_links(document_id, conference_id, committee_id, working_doc_id) values (doc, conf, cid, value)
   on conflict (document_id) do update set working_doc_id = excluded.working_doc_id, access = 'unchecked', revision = resolution_links.revision + 1, updated_at = now();
 else raise exception 'Unknown resolution link action' using errcode='22023';
 end if;
 return doc;
end; $$;
revoke all on function private.ops_resolution_link(uuid,uuid,jsonb) from public, anon, authenticated;

-- Extension command boundary. Mirrors private.apply_mutation: caller authorization, idempotent receipt,
-- committee/conference row lock, audit entry and operational notification in one transaction.
create function private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); kind text := command->>'type'; cid uuid; entity uuid; topic text := 'configuration';
 allowed public.conference_role[] := array['admin']::public.conference_role[];
 prior private.mutation_receipts;
 new_id uuid := (substr(mutation::text,1,24)||'000000000001')::uuid;
 payload jsonb := jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
begin
 if actor is null then raise exception 'Session required' using errcode='42501'; end if;
 if pg_column_size(command) > 262144 then raise exception 'Command too large' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 select * into prior from private.mutation_receipts where id = mutation;
 if found then
   if prior.actor_id <> actor or prior.conference_id <> conf or prior.payload <> payload then raise exception 'Idempotency key reused for a different action' using errcode='22023'; end if;
   return;
 end if;
 case kind
 when 'submissionLink' then
   cid := private.uuid_or_null(command->>'committeeId');
   if cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf) then raise exception 'Committee unavailable' using errcode='22023'; end if;
 when 'resolutionLink' then
   select committee_id into cid from public.documents where id = private.uuid_or_null(command->>'documentId') and conference_id = conf;
   if cid is null then raise exception 'Document unavailable' using errcode='42501'; end if;
   allowed := array['chair','admin']::public.conference_role[]; topic := 'documents';
 else raise exception 'Unknown operations command' using errcode='22023';
 end case;
 if not requested_role = any(allowed) then raise exception '% access required', case when 'chair' = any(allowed) then 'Chair' else 'Executive' end using errcode='42501'; end if;
 if not private.has_access(conf, cid, array[requested_role]) then raise exception 'This session has no access to this role or committee' using errcode='42501'; end if;
 if cid is not null then perform 1 from public.committees where id = cid and conference_id = conf for update;
 else perform 1 from public.conferences where id = conf for update; end if;
 case kind
 when 'submissionLink' then entity := private.ops_submission_link(conf, cid, actor, new_id, command);
 when 'resolutionLink' then entity := private.ops_resolution_link(conf, cid, command);
 end case;
 insert into public.audit_log(conference_id, committee_id, "actorId", action, "entityId", mutation_id, details)
 values (conf, cid, actor, kind || ' ' || coalesce(command->>'action','updated'), coalesce(entity, cid, conf), mutation,
   case kind when 'submissionLink' then command - 'token' else command end);
 insert into private.mutation_receipts(id, conference_id, actor_id, payload) values (mutation, conf, actor, payload);
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, cid, topic, mutation);
end; $$;
revoke all on function private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) from public, anon;
grant execute on function private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;
create function public.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language sql security invoker set search_path='' as $$ select private.apply_operations_mutation(conf, mutation, command, requested_role, expected, client_time); $$;
revoke all on function public.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) from public, anon;
grant execute on function public.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;

-- ---- Unauthenticated delegate submission, reachable only through the server route (service_role) ----

-- What the public submission page may show for a valid link: committee, sharing email and country names only.
create function public.submission_link_info(link_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'linkId', l.id, 'conferenceId', l.conference_id, 'committeeId', l.committee_id,
   'conferenceName', f.name, 'committeeCode', c.code, 'committeeName', c.name, 'shareWith', l.share_with,
   'submitters', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'country', d.country, 'flag', d.flag) order by d.country), '[]')
                  from public.delegates d where d.committee_id = l.committee_id))
 from public.submission_links l
 join public.committees c on c.id = l.committee_id
 join public.conferences f on f.id = l.conference_id
 where l.token = link_token and l.revoked_at is null;
$$;
revoke all on function public.submission_link_info(text) from public, anon, authenticated;

-- Registers a delegate's resolution with its committee's Chair: the existing workflow's Draft state
-- (the Chair reviews it, copies it to the Approval folder and moves it to Submitted).
-- Exactly one source: a Google Doc id (normal) or an already stored fallback file.
-- Idempotent on submission id; the same Google Doc or the same file (SHA-256) to the same committee
-- returns the original reference instead of a second resolution.
create function public.submit_resolution(link_token text, submission uuid, submitter uuid, title text, google_doc_id text,
  file_name text, storage_key text, file_sha256 text, file_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 link public.submission_links; existing private.resolution_submissions; sid uuid; n integer; doc_code text; committee_code text;
 doc_id uuid := (substr(submission::text,1,24)||'000000000001')::uuid;
 version_id uuid := (substr(submission::text,1,24)||'000000000002')::uuid;
 submitter_country text;
begin
 select * into link from public.submission_links where token = link_token and revoked_at is null;
 if not found then raise exception 'invalid_link' using errcode='P0001'; end if;
 if (submit_resolution.google_doc_id is null) = (storage_key is null) then raise exception 'invalid_source' using errcode='P0001'; end if;
 if submit_resolution.google_doc_id is not null and submit_resolution.google_doc_id !~ '^[A-Za-z0-9_-]{25,100}$' then raise exception 'invalid_google_doc' using errcode='P0001'; end if;
 -- Serialize submissions per committee (document numbering, duplicate check).
 perform 1 from public.committees where id = link.committee_id for update;
 select * into existing from private.resolution_submissions where id = submission;
 if found then
   return jsonb_build_object('status','replayed','code',(select code from public.documents where id = existing.document_id));
 end if;
 select * into existing from private.resolution_submissions s where s.committee_id = link.committee_id
   and (s.google_doc_id = submit_resolution.google_doc_id or s.file_sha256 = submit_resolution.file_sha256) order by s.created_at limit 1;
 if found then
   return jsonb_build_object('status','duplicate','code',(select code from public.documents where id = existing.document_id));
 end if;
 if (select count(*) from private.resolution_submissions where link_id = link.id and created_at > now() - interval '10 minutes') >= 20 then
   raise exception 'rate_limited' using errcode='P0001';
 end if;
 select country into submitter_country from public.delegates where id = submitter and committee_id = link.committee_id and conference_id = link.conference_id;
 if submitter_country is null then raise exception 'invalid_submitter' using errcode='P0001'; end if;
 if length(trim(coalesce(title,''))) < 3 or length(title) > 200 then raise exception 'invalid_title' using errcode='P0001'; end if;
 if storage_key is not null and (submit_resolution.file_sha256 is null or coalesce(submit_resolution.file_size, 0) <= 0
     or storage_key not like link.conference_id::text || '/' || link.committee_id::text || '/' || doc_id::text || '/%') then
   raise exception 'invalid_storage_key' using errcode='P0001';
 end if;
 -- The committee's current session: active, else the latest started, else the first scheduled.
 select id into sid from public.sessions s where s.committee_id = link.committee_id
  order by (s.state = 'active') desc, (s."startsAt" <= now()) desc,
           case when s."startsAt" <= now() then s."startsAt" end desc nulls last, s."startsAt" asc
  limit 1;
 if sid is null then raise exception 'no_session' using errcode='P0001'; end if;
 select code into committee_code from public.committees where id = link.committee_id;
 select count(*) + 1 into n from public.documents where committee_id = link.committee_id;
 loop
   doc_code := committee_code || ' / ' || lpad(n::text, 2, '0');
   exit when not exists(select 1 from public.documents where conference_id = link.conference_id and code = doc_code);
   n := n + 1;
 end loop;
 insert into public.documents(id, conference_id, committee_id, "sessionId", "submitterId", code, title, status)
 values (doc_id, link.conference_id, link.committee_id, sid, submitter, doc_code, trim(title), 'Draft');
 insert into public.document_versions(id, conference_id, committee_id, "documentId", number, "fileName", "storageKey", text)
 values (version_id, link.conference_id, link.committee_id, doc_id, 1,
   case when storage_key is null then 'Google Doc' else left(file_name, 200) end, storage_key,
   'Submitted through the ' || committee_code || ' submission link by ' || submitter_country || '.' || chr(10) ||
   case when storage_key is null
     then 'Working document: Google Doc.' || chr(10) || chr(10) || 'The resolution text lives in the Google Doc. Use “Open Google Doc”.'
     else 'Uploaded file (fallback): ' || left(file_name, 200) || ' (' || greatest(1, round(submit_resolution.file_size / 1024.0))::text || ' KB).' || chr(10) || chr(10) || 'Open the submitted file to read it.'
   end);
 insert into public.resolution_links(document_id, conference_id, committee_id, working_doc_id, submitted_at)
 values (doc_id, link.conference_id, link.committee_id, submit_resolution.google_doc_id, now());
 insert into private.resolution_submissions(id, conference_id, committee_id, link_id, document_id, google_doc_id, file_sha256, file_size)
 values (submission, link.conference_id, link.committee_id, link.id, doc_id, submit_resolution.google_doc_id, submit_resolution.file_sha256, submit_resolution.file_size);
 -- Notifies the committee's Chair through the existing Realtime path.
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (link.conference_id, link.committee_id, 'documents', submission);
 return jsonb_build_object('status','created','code',doc_code);
end; $$;
revoke all on function public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer) from public, anon, authenticated;

do $$ begin
 if exists(select 1 from pg_roles where rolname = 'service_role') then
   grant execute on function public.submission_link_info(text) to service_role;
   grant execute on function public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer) to service_role;
 end if;
end $$;

-- Private Storage bucket for the OPTIONAL upload fallback (and future snapshots).
-- Objects: {conference}/{committee}/{document}/{version}.{ext}. Only the server route writes (service_role).
-- Staff with access to that committee may read (signed URLs). Guarded so plain PostgreSQL tests run it.
do $$ begin
 if exists(select 1 from pg_namespace where nspname = 'storage') then
   insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
   values ('resolutions', 'resolutions', false, 4194304, array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
   on conflict (id) do nothing;
   execute $p$create policy resolutions_staff_read on storage.objects for select to authenticated using (
     bucket_id = 'resolutions' and private.has_access(
       private.uuid_or_null((storage.foldername(name))[1]), private.uuid_or_null((storage.foldername(name))[2]),
       array['admin','chair','approval','logistics']::public.conference_role[]))$p$;
 end if;
end $$;
