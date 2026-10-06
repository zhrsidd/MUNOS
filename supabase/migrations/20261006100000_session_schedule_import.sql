-- Conference schedule import (Claude-owned).
-- CODEX REVIEW REQUIRED: adds the nullable column public.sessions."endsAt" (core table).
-- It also adds the sessionImport handler to Claude's own extension dispatcher.
-- Nothing else in the core changes: conference_snapshot already serializes every session column,
-- so "endsAt" appears in snapshots automatically; existing session commands leave it null.

alter table public.sessions add column "endsAt" timestamptz;
alter table public.sessions add constraint sessions_ends_after_start check ("endsAt" is null or "endsAt" > "startsAt");
create index sessions_committee_start on public.sessions(committee_id, "startsAt");

-- Handlers run inside private.apply_operations_mutation (SECURITY DEFINER) and are not callable directly.
-- Bulk session creation. Row n gets id substr(mutation,1,24)||hex(n), matching the client's optimistic ids.
-- A session that already exists for the same committee and start time is skipped (safe re-import).
create function private.ops_session_import(conf uuid, mutation uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare r jsonb; n integer := 0; cid uuid; starts timestamptz; ends timestamptz; session_name text; affected uuid[] := '{}';
begin
 if jsonb_typeof(command->'rows') is distinct from 'array' or jsonb_array_length(command->'rows') not between 1 and 500 then
   raise exception 'Import between 1 and 500 sessions at a time' using errcode='22023';
 end if;
 for r in select value from jsonb_array_elements(command->'rows') loop
   n := n + 1;
   cid := private.uuid_or_null(r->>'committeeId');
   session_name := trim(r->>'name');
   starts := (r->>'startsAt')::timestamptz;
   ends := nullif(r->>'endsAt','')::timestamptz;
   if cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf) then raise exception 'Committee unavailable' using errcode='22023'; end if;
   if session_name is null or length(session_name) not between 1 and 120 then raise exception 'Session name required' using errcode='22023'; end if;
   if starts is null or (ends is not null and ends <= starts) then raise exception 'Session times invalid' using errcode='22023'; end if;
   continue when exists(select 1 from public.sessions where committee_id = cid and "startsAt" = starts);
   insert into public.sessions(id, conference_id, committee_id, name, "startsAt", "endsAt", state)
   values ((substr(mutation::text,1,24)||lpad(to_hex(n),12,'0'))::uuid, conf, cid, session_name, starts, ends, 'scheduled');
   if not cid = any(affected) then affected := affected || cid; end if;
 end loop;
 return affected;
end; $$;
revoke all on function private.ops_session_import(uuid,uuid,jsonb) from public, anon, authenticated;

-- Dispatcher: shared authorization, idempotency, locking, audit and notification for every extension command.
create or replace function private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); kind text := command->>'type'; cid uuid; entity uuid; affected uuid[] := '{}'; c uuid; topic text := 'configuration';
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
 when 'sessionImport' then cid := null;
 else raise exception 'Unknown operations command' using errcode='22023';
 end case;
 if not requested_role = any(allowed) then raise exception '% access required', case when 'chair' = any(allowed) then 'Chair' else 'Executive' end using errcode='42501'; end if;
 if not private.has_access(conf, cid, array[requested_role]) then raise exception 'This session has no access to this role or committee' using errcode='42501'; end if;
 if cid is not null then perform 1 from public.committees where id = cid and conference_id = conf for update;
 else perform 1 from public.conferences where id = conf for update; end if;
 case kind
 when 'submissionLink' then entity := private.ops_submission_link(conf, cid, actor, new_id, command);
 when 'resolutionLink' then entity := private.ops_resolution_link(conf, cid, command);
 when 'sessionImport' then affected := private.ops_session_import(conf, mutation, command);
 end case;
 insert into public.audit_log(conference_id, committee_id, "actorId", action, "entityId", mutation_id, details)
 values (conf, cid, actor, kind || ' ' || coalesce(command->>'action', 'updated'), coalesce(entity, cid, conf), mutation,
   case kind when 'submissionLink' then command - 'token' when 'sessionImport' then jsonb_build_object('type', kind, 'rows', jsonb_array_length(command->'rows')) else command end);
 insert into private.mutation_receipts(id, conference_id, actor_id, payload) values (mutation, conf, actor, payload);
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, cid, topic, mutation);
 -- Chairs subscribe per committee: notify each affected committee as well (one small row each).
 foreach c in array affected loop
   insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, c, 'configuration', gen_random_uuid());
 end loop;
end; $$;
