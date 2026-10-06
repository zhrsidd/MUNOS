-- Review hardening for Claude operations PRs #3–#5. Created with the Supabase CLI;
-- ordered after the three not-yet-applied extension migrations to preserve their dependencies.
-- No public reads or direct writes are added. Core mutation/outbox contract remains independent.

-- Link visibility must follow the document lifecycle, just like versions and comments.
drop policy read_authorized on public.resolution_links;
create policy read_authorized on public.resolution_links for select to authenticated
 using (exists(select 1 from public.documents d where d.id = resolution_links.document_id));

-- A folder prefix alone must never authorize unsubmitted or orphaned uploaded bytes.
do $$ begin
 if exists(select 1 from pg_namespace where nspname = 'storage') then
   execute 'drop policy if exists resolutions_staff_read on storage.objects';
   execute $p$create policy resolutions_staff_read on storage.objects for select to authenticated using (
     bucket_id = 'resolutions' and exists (
       select 1 from public.document_versions v where v."storageKey" = storage.objects.name
       and private.has_access(v.conference_id,v.committee_id,array['admin','chair','approval','logistics']::public.conference_role[])
     ))$p$;
 end if;
end $$;
create index document_versions_storage_key on public.document_versions("storageKey") where "storageKey" is not null;
create policy no_browser_access on private.resolution_submissions for all to anon,authenticated using(false) with check(false);

-- Bind a receipt to its exact logical input, including committee, link and source bytes.
alter table private.resolution_submissions add column request_payload jsonb;
update private.resolution_submissions s set request_payload = jsonb_build_object(
 'submitter',d."submitterId",'title',trim(d.title),'googleDocId',s.google_doc_id,
 'fileName',case when s.google_doc_id is null then v."fileName" else null end,
 'storageKey',v."storageKey",'sha256',s.file_sha256,'size',s.file_size)
from public.documents d, public.document_versions v
where d.id=s.document_id and v."documentId"=d.id and v.number=1;
alter table private.resolution_submissions alter column request_payload set not null;

create or replace function public.submit_resolution(link_token text, submission uuid, submitter uuid, title text, google_doc_id text,
  file_name text, storage_key text, file_sha256 text, file_size integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 link public.submission_links; existing private.resolution_submissions; sid uuid; n integer; doc_code text; committee_code text;
 doc_id uuid := (substr(submission::text,1,24)||'000000000001')::uuid;
 version_id uuid := (substr(submission::text,1,24)||'000000000002')::uuid;
 submitter_country text; request_payload jsonb;
begin
 select * into link from public.submission_links where token = link_token and revoked_at is null;
 if not found then raise exception 'invalid_link' using errcode='P0001'; end if;
 if (submit_resolution.google_doc_id is null) = (storage_key is null) then raise exception 'invalid_source' using errcode='P0001'; end if;
 if submit_resolution.google_doc_id is not null and submit_resolution.google_doc_id !~ '^[A-Za-z0-9_-]{25,100}$' then raise exception 'invalid_google_doc' using errcode='P0001'; end if;
 request_payload := jsonb_build_object('submitter',submitter,'title',trim(title),'googleDocId',google_doc_id,
   'fileName',case when storage_key is null then null else left(file_name,200) end,
   'storageKey',storage_key,'sha256',file_sha256,'size',file_size);
 -- Serialize a submission UUID across committees before acquiring its committee lock.
 perform pg_advisory_xact_lock(hashtextextended('submission:' || submission::text,0));
 -- Serialize submissions per committee (document numbering, duplicate check).
 perform 1 from public.committees where id = link.committee_id for update;
 if not exists(select 1 from public.submission_links where id=link.id and revoked_at is null) then raise exception 'invalid_link' using errcode='P0001'; end if;
 select * into existing from private.resolution_submissions where id = submission;
 if found then
   if existing.link_id <> link.id or existing.conference_id <> link.conference_id or existing.committee_id <> link.committee_id
      or existing.request_payload is distinct from request_payload then
     raise exception 'idempotency_conflict' using errcode='22023';
   end if;
   return jsonb_build_object('status','replayed','code',(select code from public.documents where id = existing.document_id));
 end if;
 select * into existing from private.resolution_submissions s where s.committee_id = link.committee_id
   and (s.google_doc_id = submit_resolution.google_doc_id or s.file_sha256 = submit_resolution.file_sha256) order by s.created_at limit 1;
 if found then
   if not exists(select 1 from public.delegates where id=submitter and committee_id=link.committee_id) then raise exception 'invalid_submitter' using errcode='P0001'; end if;
   insert into private.resolution_submissions(id,conference_id,committee_id,link_id,document_id,google_doc_id,file_sha256,file_size,request_payload)
   values(submission,link.conference_id,link.committee_id,link.id,existing.document_id,submit_resolution.google_doc_id,submit_resolution.file_sha256,submit_resolution.file_size,request_payload);
   return jsonb_build_object('status','duplicate','code',(select code from public.documents where id = existing.document_id),
     'storageKey',(select v."storageKey" from public.document_versions v where v."documentId"=existing.document_id and v.number=1));
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
 insert into private.resolution_submissions(id, conference_id, committee_id, link_id, document_id, google_doc_id, file_sha256, file_size, request_payload)
 values (submission, link.conference_id, link.committee_id, link.id, doc_id, submit_resolution.google_doc_id, submit_resolution.file_sha256, submit_resolution.file_size, request_payload);
 -- Notifies the committee's Chair through the existing Realtime path.
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (link.conference_id, link.committee_id, 'documents', submission);
 return jsonb_build_object('status','created','code',doc_code);
end; $$;

create or replace function private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); kind text := command->>'type'; cid uuid; entity uuid; affected uuid[] := '{}'; c uuid; topic text := 'configuration';
 allowed public.conference_role[] := array['admin']::public.conference_role[];
 prior private.mutation_receipts; actual text;
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
 when 'submissionLink', 'photoAck' then
   cid := private.uuid_or_null(command->>'committeeId');
   if cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf) then raise exception 'Committee unavailable' using errcode='22023'; end if;
   if kind = 'photoAck' then allowed := array['chair']::public.conference_role[]; topic := 'chair'; end if;
 when 'resolutionLink' then
   select committee_id into cid from public.documents where id = private.uuid_or_null(command->>'documentId') and conference_id = conf;
   if cid is null then raise exception 'Document unavailable' using errcode='42501'; end if;
   allowed := array['chair','admin']::public.conference_role[]; topic := 'documents';
 when 'sessionImport', 'photoSlot', 'photoImport' then cid := null;
 else raise exception 'Unknown operations command' using errcode='22023';
 end case;
 if not requested_role = any(allowed) then raise exception '% access required', case when 'chair' = any(allowed) then 'Chair' else 'Executive' end using errcode='42501'; end if;
 if not private.has_access(conf, cid, array[requested_role]) then raise exception 'This session has no access to this role or committee' using errcode='42501'; end if;
 if cid is not null then perform 1 from public.committees where id = cid and conference_id = conf for update;
 else perform 1 from public.conferences where id = conf for update; end if;
 -- Compare under the same lock as the write. A missing precondition is not permission to overwrite.
 if kind = 'resolutionLink' then
   select revision::text into actual from public.resolution_links where document_id = private.uuid_or_null(command->>'documentId');
   actual := coalesce(actual,'0');
 elsif kind = 'photoSlot' and command->>'action' = 'update' then
   select revision::text into actual from public.photo_slots where id = private.uuid_or_null(command->>'slotId') and conference_id = conf;
   actual := coalesce(actual,'0');
 elsif kind = 'submissionLink' then
   select id::text || '|' || share_with into actual from public.submission_links where committee_id = cid and revoked_at is null;
   actual := coalesce(actual,'none');
 end if;
 if actual is not null and expected is distinct from actual then
   raise exception 'This item changed on another device. Review the saved change before retrying.' using errcode='40001';
 end if;
 case kind
 when 'submissionLink' then entity := private.ops_submission_link(conf, cid, actor, new_id, command);
 when 'resolutionLink' then entity := private.ops_resolution_link(conf, cid, command);
 when 'sessionImport' then affected := private.ops_session_import(conf, mutation, command);
 when 'photoSlot' then affected := private.ops_photo_slot(conf, new_id, command); entity := coalesce(private.uuid_or_null(command->>'slotId'), new_id);
 when 'photoImport' then affected := private.ops_photo_import(conf, mutation, command);
 when 'photoAck' then entity := private.ops_photo_ack(conf, cid, actor, command);
 end case;
 insert into public.audit_log(conference_id, committee_id, "actorId", action, "entityId", mutation_id, details)
 values (conf, cid, actor, kind || ' ' || coalesce(command->>'action', command->>'stage', 'updated'), coalesce(entity, cid, conf), mutation,
   case kind when 'submissionLink' then command - 'token' when 'sessionImport' then jsonb_build_object('type', kind, 'rows', jsonb_array_length(command->'rows'))
             when 'photoImport' then jsonb_build_object('type', kind, 'rows', jsonb_array_length(command->'rows')) else command end);
 insert into private.mutation_receipts(id, conference_id, actor_id, payload) values (mutation, conf, actor, payload);
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, cid, topic, mutation);
 -- Chairs subscribe per committee: notify each affected committee as well (one small row each).
 foreach c in array affected loop
   continue when c is not distinct from cid;
   insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, c, 'configuration', gen_random_uuid());
 end loop;
end; $$;
