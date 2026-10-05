-- School group-photo schedule and chair reminders (Claude-owned). Additive only.
-- Reminders are derived on each device from these authoritative timestamps; Realtime only speeds up refresh.
-- CODEX REVIEW REQUIRED only for the shared pattern (new tables readable by staff); no core table changes.

create table public.photo_slots (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 school_id uuid not null,
 starts_at timestamptz not null, ends_at timestamptz,
 location text not null check (length(trim(location)) between 1 and 120),
 note text not null default '' check (length(note) <= 300),
 enabled boolean not null default true,
 warn_minutes integer not null default 10 check (warn_minutes between 1 and 60),
 revision bigint not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (ends_at is null or ends_at > starts_at),
 unique (id, conference_id),
 foreign key (school_id, conference_id) references public.schools(id, conference_id)
);
create index photo_slots_conference_start on public.photo_slots(conference_id, starts_at);
create index photo_slots_school on public.photo_slots(school_id);
alter table public.photo_slots enable row level security;
revoke all on public.photo_slots from anon, authenticated;
grant select on public.photo_slots to authenticated;
create policy read_authorized on public.photo_slots for select to authenticated
 using (private.has_access(conference_id, null, array['admin','chair','approval','logistics','observer']::public.conference_role[])
        or exists(select 1 from public.user_access a where a.user_id = (select auth.uid()) and a.conference_id = photo_slots.conference_id and a.role = 'chair' and a.revoked_at is null and a.expires_at > now()));

-- One row per committee, slot, stage ("warning" / "due") and slot revision. A rescheduled slot has a new
-- revision, so earlier acknowledgements no longer count and the reminder appears again.
create table public.photo_acknowledgements (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null, slot_id uuid not null,
 stage text not null check (stage in ('warning','due')), slot_revision bigint not null,
 actor_id uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (slot_id, committee_id, stage, slot_revision),
 foreign key (committee_id, conference_id) references public.committees(id, conference_id),
 foreign key (slot_id, conference_id) references public.photo_slots(id, conference_id)
);
create index photo_acknowledgements_conference on public.photo_acknowledgements(conference_id);
create index photo_acknowledgements_committee on public.photo_acknowledgements(committee_id);
alter table public.photo_acknowledgements enable row level security;
revoke all on public.photo_acknowledgements from anon, authenticated;
grant select on public.photo_acknowledgements to authenticated;
create policy read_authorized on public.photo_acknowledgements for select to authenticated
 using (private.has_access(conference_id, committee_id, array['admin','chair','observer']::public.conference_role[]));

-- Committees with at least one delegate from the given schools (for targeted notifications).
create function private.committees_for_schools(schools uuid[]) returns uuid[] language sql stable set search_path='' as $$
 select coalesce(array_agg(distinct committee_id), '{}') from public.delegates where "schoolId" = any(schools);
$$;
revoke all on function private.committees_for_schools(uuid[]) from public, anon, authenticated;

create function private.ops_photo_slot(conf uuid, new_id uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare slot_id uuid := private.uuid_or_null(command->>'slotId'); school uuid := private.uuid_or_null(command->>'schoolId'); old_school uuid;
begin
 if school is null or not exists(select 1 from public.schools where id = school and conference_id = conf) then raise exception 'School unavailable' using errcode='22023'; end if;
 if command->>'action' = 'create' then
   insert into public.photo_slots(id, conference_id, school_id, starts_at, ends_at, location, note, enabled, warn_minutes)
   values (new_id, conf, school, (command->>'startsAt')::timestamptz, nullif(command->>'endsAt','')::timestamptz, trim(command->>'location'),
           coalesce(command->>'note',''), coalesce((command->>'enabled')::boolean, true), coalesce((command->>'warnMinutes')::integer, 10));
   return private.committees_for_schools(array[school]);
 elsif command->>'action' = 'update' then
   select school_id into old_school from public.photo_slots where id = slot_id and conference_id = conf for update;
   if old_school is null then raise exception 'Photo slot unavailable' using errcode='22023'; end if;
   update public.photo_slots set school_id = school, starts_at = (command->>'startsAt')::timestamptz, ends_at = nullif(command->>'endsAt','')::timestamptz,
     location = trim(command->>'location'), note = coalesce(command->>'note',''), enabled = coalesce((command->>'enabled')::boolean, true),
     warn_minutes = coalesce((command->>'warnMinutes')::integer, 10), revision = revision + 1, updated_at = now()
   where id = slot_id;
   return private.committees_for_schools(array[school, old_school]);
 end if;
 raise exception 'Unknown photo action' using errcode='22023';
end; $$;
revoke all on function private.ops_photo_slot(uuid,uuid,jsonb) from public, anon, authenticated;

-- Bulk import. A slot for the same school and start time is skipped. Row n gets id prefix||hex(n).
create function private.ops_photo_import(conf uuid, mutation uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare r jsonb; n integer := 0; school uuid; starts timestamptz; schools uuid[] := '{}';
begin
 if jsonb_typeof(command->'rows') is distinct from 'array' or jsonb_array_length(command->'rows') not between 1 and 300 then raise exception 'Import between 1 and 300 photo slots at a time' using errcode='22023'; end if;
 for r in select value from jsonb_array_elements(command->'rows') loop
   n := n + 1;
   school := private.uuid_or_null(r->>'schoolId'); starts := (r->>'startsAt')::timestamptz;
   if school is null or not exists(select 1 from public.schools where id = school and conference_id = conf) then raise exception 'School unavailable' using errcode='22023'; end if;
   continue when exists(select 1 from public.photo_slots where school_id = school and starts_at = starts);
   insert into public.photo_slots(id, conference_id, school_id, starts_at, ends_at, location, note, warn_minutes)
   values ((substr(mutation::text,1,24)||lpad(to_hex(n),12,'0'))::uuid, conf, school, starts, nullif(r->>'endsAt','')::timestamptz, trim(r->>'location'),
           coalesce(r->>'note',''), coalesce((r->>'warnMinutes')::integer, 10));
   schools := schools || school;
 end loop;
 return private.committees_for_schools(schools);
end; $$;
revoke all on function private.ops_photo_import(uuid,uuid,jsonb) from public, anon, authenticated;

create function private.ops_photo_ack(conf uuid, cid uuid, actor uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare slot public.photo_slots;
begin
 select * into slot from public.photo_slots where id = private.uuid_or_null(command->>'slotId') and conference_id = conf;
 if not found then raise exception 'Photo slot unavailable' using errcode='22023'; end if;
 if command->>'stage' not in ('warning','due') then raise exception 'Unknown reminder stage' using errcode='22023'; end if;
 -- Acknowledging an older revision is harmless: it simply does not silence the current reminder.
 insert into public.photo_acknowledgements(conference_id, committee_id, slot_id, stage, slot_revision, actor_id)
 values (conf, cid, slot.id, command->>'stage', (command->>'revision')::bigint, actor)
 on conflict (slot_id, committee_id, stage, slot_revision) do nothing;
 return slot.id;
end; $$;
revoke all on function private.ops_photo_ack(uuid,uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.operations_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'submissionLinks', (select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'committeeId',l.committee_id,'token',l.token,'shareWith',l.share_with,'createdAt',l.created_at) order by l.created_at, l.id),'[]')
    from public.submission_links l where l.conference_id = conf and l.revoked_at is null),
  'resolutionLinks', (select coalesce(jsonb_agg(jsonb_build_object('documentId',r.document_id,'workingDocId',r.working_doc_id,'approvalCopyDocId',r.approval_copy_doc_id,'access',r.access,'submittedAt',r.submitted_at,'revision',r.revision) order by r.created_at, r.document_id),'[]')
    from public.resolution_links r where r.conference_id = conf),
  'photoSlots', (select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'schoolId',p.school_id,'startsAt',p.starts_at,'endsAt',p.ends_at,'location',p.location,'note',p.note,'enabled',p.enabled,'warnMinutes',p.warn_minutes,'revision',p.revision) order by p.starts_at, p.id),'[]')
    from public.photo_slots p where p.conference_id = conf),
  'photoAcks', (select coalesce(jsonb_agg(jsonb_build_object('slotId',a.slot_id,'committeeId',a.committee_id,'stage',a.stage,'revision',a.slot_revision,'at',a.created_at) order by a.created_at),'[]')
    from public.photo_acknowledgements a where a.conference_id = conf)
 );
$$;

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
