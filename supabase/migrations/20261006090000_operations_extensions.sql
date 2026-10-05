-- Conference operations extensions (Claude-owned) — resolution submission links.
-- CODEX REVIEW REQUIRED. See docs/OPERATIONS_EXTENSIONS.md.
--
-- Additive only: no existing table, policy or function is altered.
--  * public.submission_links: one active, unguessable link per committee. Staff read via RLS.
--  * private.resolution_submissions: idempotency, duplicate detection and rate limiting
--    for unauthenticated delegate submissions. No browser access.
--  * public.operations_snapshot(conf): RLS-respecting read of extension data, merged by the client
--    into the core conference_snapshot.
--  * public.apply_operations_mutation(...): same idempotent outbox contract as
--    apply_conference_mutation (receipt, audit, operational change) for extension commands.
--  * public.submission_link_info / public.submit_resolution: callable ONLY by service_role
--    (the server route holding SUPABASE_SECRET_KEY). Never granted to anon or authenticated.
--  * Storage bucket "resolutions" (private) and a staff read policy scoped by path.

create table public.submission_links (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 token text not null unique check (token ~ '^[A-Za-z0-9_-]{22,64}$'),
 contact text not null default '' check (length(contact) <= 200),
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

create table private.resolution_submissions (
 id uuid primary key, conference_id uuid not null references public.conferences(id),
 committee_id uuid not null, link_id uuid not null references public.submission_links(id),
 document_id uuid not null references public.documents(id), file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
 file_size integer not null check (file_size > 0), created_at timestamptz not null default now()
);
create index resolution_submissions_duplicate on private.resolution_submissions(committee_id, file_sha256);
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
  'submissionLinks', (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'committeeId',l.committee_id,'token',l.token,'contact',l.contact,'createdAt',l.created_at) order by l.created_at, l.id),'[]')
    from public.submission_links l where l.conference_id = conf and l.revoked_at is null)
 );
$$;
revoke all on function public.operations_snapshot(uuid) from public, anon;
grant execute on function public.operations_snapshot(uuid) to authenticated;

-- Extension command boundary. Mirrors private.apply_mutation: caller authorization, idempotent receipt,
-- committee/conference row lock, audit entry and operational notification in one transaction.
create function private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); kind text := command->>'type'; cid uuid; entity uuid; topic text := 'configuration';
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
 cid := private.uuid_or_null(command->>'committeeId');
 if kind = 'submissionLink' then
   if requested_role <> 'admin' then raise exception 'Executive access required' using errcode='42501'; end if;
   if cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf) then raise exception 'Committee unavailable' using errcode='22023'; end if;
 else raise exception 'Unknown operations command' using errcode='22023';
 end if;
 if not private.has_access(conf, cid, array[requested_role]) then raise exception 'This session has no access to this role or committee' using errcode='42501'; end if;
 perform 1 from public.committees where id = cid and conference_id = conf for update;
 case kind
 when 'submissionLink' then
   -- create and rotate both replace the active link; revoke only retires it.
   update public.submission_links set revoked_at = now(), updated_at = now() where committee_id = cid and revoked_at is null;
   if command->>'action' in ('create','rotate') then
     insert into public.submission_links(id, conference_id, committee_id, token, contact, created_by)
     values (new_id, conf, cid, command->>'token', left(coalesce(command->>'contact',''),200), actor);
     entity := new_id;
   elsif command->>'action' <> 'revoke' then raise exception 'Unknown link action' using errcode='22023';
   end if;
 end case;
 insert into public.audit_log(conference_id, committee_id, "actorId", action, "entityId", mutation_id, details)
 values (conf, cid, actor, kind || ' ' || coalesce(command->>'action','updated'), coalesce(entity, cid), mutation, command - 'token');
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

-- What the public submission page may show for a valid link: committee and country names only.
create function public.submission_link_info(link_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
   'linkId', l.id, 'conferenceId', l.conference_id, 'committeeId', l.committee_id,
   'conferenceName', f.name, 'committeeCode', c.code, 'committeeName', c.name, 'contact', l.contact,
   'submitters', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'country', d.country, 'flag', d.flag) order by d.country), '[]')
                  from public.delegates d where d.committee_id = l.committee_id))
 from public.submission_links l
 join public.committees c on c.id = l.committee_id
 join public.conferences f on f.id = l.conference_id
 where l.token = link_token and l.revoked_at is null;
$$;
revoke all on function public.submission_link_info(text) from public, anon, authenticated;

-- Creates the resolution directly in the existing "Submitted" state of the authoritative workflow.
-- Called only AFTER the file is stored, so a failed upload never advances the workflow.
-- Idempotent on submission id; duplicate files (same committee + SHA-256) return the original.
create function public.submit_resolution(link_token text, submission uuid, submitter uuid, title text, file_name text, storage_key text, file_sha256 text, file_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 link public.submission_links; existing private.resolution_submissions; sid uuid; n integer; doc_code text;
 doc_id uuid := (substr(submission::text,1,24)||'000000000001')::uuid;
 version_id uuid := (substr(submission::text,1,24)||'000000000002')::uuid;
 submitter_country text;
begin
 select * into link from public.submission_links where token = link_token and revoked_at is null;
 if not found then raise exception 'invalid_link' using errcode='P0001'; end if;
 -- Serialize submissions per committee (document numbering, duplicate check).
 perform 1 from public.committees where id = link.committee_id for update;
 select * into existing from private.resolution_submissions where id = submission;
 if found then
   return jsonb_build_object('status','replayed','code',(select code from public.documents where id = existing.document_id));
 end if;
 select * into existing from private.resolution_submissions where committee_id = link.committee_id and resolution_submissions.file_sha256 = submit_resolution.file_sha256 order by created_at limit 1;
 if found then
   return jsonb_build_object('status','duplicate','code',(select code from public.documents where id = existing.document_id));
 end if;
 if (select count(*) from private.resolution_submissions where link_id = link.id and created_at > now() - interval '10 minutes') >= 20 then
   raise exception 'rate_limited' using errcode='P0001';
 end if;
 select country into submitter_country from public.delegates where id = submitter and committee_id = link.committee_id and conference_id = link.conference_id;
 if submitter_country is null then raise exception 'invalid_submitter' using errcode='P0001'; end if;
 if length(trim(coalesce(title,''))) < 3 or length(title) > 200 then raise exception 'invalid_title' using errcode='P0001'; end if;
 if storage_key is null or storage_key not like link.conference_id::text || '/' || link.committee_id::text || '/' || doc_id::text || '/%' then raise exception 'invalid_storage_key' using errcode='P0001'; end if;
 -- The committee's current session: active, else the latest started, else the first scheduled.
 select id into sid from public.sessions s where s.committee_id = link.committee_id
  order by (s.state = 'active') desc, (s."startsAt" <= now()) desc,
           case when s."startsAt" <= now() then s."startsAt" end desc nulls last, s."startsAt" asc
  limit 1;
 if sid is null then raise exception 'no_session' using errcode='P0001'; end if;
 select count(*) + 1 into n from public.documents where committee_id = link.committee_id;
 loop
   doc_code := (select code from public.committees where id = link.committee_id) || ' / ' || lpad(n::text, 2, '0');
   exit when not exists(select 1 from public.documents where conference_id = link.conference_id and code = doc_code);
   n := n + 1;
 end loop;
 insert into public.documents(id, conference_id, committee_id, "sessionId", "submitterId", code, title, status)
 values (doc_id, link.conference_id, link.committee_id, sid, submitter, doc_code, trim(title), 'Submitted');
 insert into public.document_versions(id, conference_id, committee_id, "documentId", number, "fileName", "storageKey", text)
 values (version_id, link.conference_id, link.committee_id, doc_id, 1, left(file_name, 200), storage_key,
   'Submitted through the ' || (select code from public.committees where id = link.committee_id) || ' submission link by ' || submitter_country || '.' || chr(10) ||
   'File: ' || left(file_name, 200) || ' (' || greatest(1, round(file_size / 1024.0))::text || ' KB).' || chr(10) || chr(10) ||
   'Open the submitted file to review the full text.');
 insert into private.resolution_submissions(id, conference_id, committee_id, link_id, document_id, file_sha256, file_size)
 values (submission, link.conference_id, link.committee_id, link.id, doc_id, submit_resolution.file_sha256, file_size);
 -- Notifies the committee's Chair and the Approval Panel through the existing Realtime path.
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (link.conference_id, link.committee_id, 'documents', submission);
 return jsonb_build_object('status','created','code',doc_code);
end; $$;
revoke all on function public.submit_resolution(text,uuid,uuid,text,text,text,text,integer) from public, anon, authenticated;

do $$ begin
 if exists(select 1 from pg_roles where rolname = 'service_role') then
   grant execute on function public.submission_link_info(text) to service_role;
   grant execute on function public.submit_resolution(text,uuid,uuid,text,text,text,text,integer) to service_role;
 end if;
end $$;

-- Private Storage bucket. Objects: {conference}/{committee}/{document}/{version}.{ext}.
-- Only the server route writes (service_role). Staff with access to that committee may read (signed URLs).
-- Guarded so the same migration runs in plain PostgreSQL tests.
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
