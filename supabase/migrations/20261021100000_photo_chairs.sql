-- Delegates and Chairs in school group photos (docs/plans/PROTECTED_FEATURES_PLAN.md §2).
-- A Chair may have a school; that school's photo slots then remind the Chair's committees, as delegates do.
-- Additive: one nullable column with a conference-scoped FK, one small epoch table with triggers, two defaulted
-- columns on photo_acknowledgements (their unique key widens to include them), private helpers and one new command.
-- An acknowledgement silences a reminder only at the current participant-list epoch (sections 5 and 6), so a Chair
-- change reminds the committee again and no earlier acknowledgement can be reused.
-- Chairs cannot read public.staff (Executive-only RLS, unchanged). They receive only the narrow photoChairs
-- projection: name, committee and school of Chairs with a school, for committees they can already access.
-- private.apply_operations_mutation and public.operations_snapshot are PATCHED with exact anchors. Fail closed.

-- 1) A Chair's school. Null means no school (today's behaviour).
alter table public.staff add column "schoolId" uuid,
 add constraint staff_school_scope foreign key ("schoolId",conference_id) references public.schools(id,conference_id);
create index staff_school_idx on public.staff("schoolId") where "schoolId" is not null;

-- 2) Chairs with a school, one row per assigned committee, limited to committees the caller can access.
--    SECURITY DEFINER because Chairs cannot read staff; it exposes only these four fields.
create function private.photo_chairs(conf uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('staffId',s.id,'name',s.name,'committeeId',a.committee_id,'schoolId',s."schoolId") order by s.name,s.id,a.committee_id),'[]')
 from public.staff s
 join public.conference_staff f on f.staff_id=s.id and f.conference_id=conf and f.role='chair'
 join public.committee_staff a on a.staff_id=s.id and a.conference_id=conf
 where s.conference_id=conf and s."schoolId" is not null
  and private.has_access(conf,a.committee_id,array['admin','chair','observer']::public.conference_role[]);
$$;
revoke all on function private.photo_chairs(uuid) from public,anon;
grant execute on function private.photo_chairs(uuid) to authenticated;

-- 3) Targeted notifications: committees with a delegate OR a Chair from the given schools.
create or replace function private.committees_for_schools(schools uuid[]) returns uuid[] language sql stable set search_path='' as $$
 select coalesce(array_agg(distinct x.committee_id), '{}') from (
  select committee_id from public.delegates where "schoolId" = any(schools)
  union
  select a.committee_id from public.committee_staff a
   join public.staff s on s.id=a.staff_id and s.conference_id=a.conference_id
   join public.conference_staff f on f.staff_id=s.id and f.conference_id=s.conference_id and f.role='chair'
   where s."schoolId" = any(schools)
 ) x;
$$;
revoke all on function private.committees_for_schools(uuid[]) from public, anon, authenticated;

-- 4) Executive sets or clears a Chair's school. Returns the Chair's committees so their devices refresh.
create function private.ops_staff_school(conf uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare member uuid := private.uuid_or_null(command->>'staffId'); school uuid := private.uuid_or_null(command->>'schoolId');
begin
 if member is null or not exists(select 1 from public.conference_staff where staff_id = member and conference_id = conf and role = 'chair') then raise exception 'Choose a Chair.' using errcode='22023'; end if;
 if command->>'schoolId' is not null and (school is null or not exists(select 1 from public.schools where id = school and conference_id = conf)) then raise exception 'School unavailable' using errcode='22023'; end if;
 update public.staff set "schoolId" = school, updated_at = now() where id = member and conference_id = conf;
 return (select coalesce(array_agg(committee_id), '{}') from public.committee_staff where staff_id = member and conference_id = conf);
end $$;
revoke all on function private.ops_staff_school(uuid,jsonb) from public, anon, authenticated;

-- 5) Participant-list epochs. The Chairs of one committee's photo for one school change whenever a Chair's school,
--    committee assignment or role changes. Each change advances an epoch kept per (committee, school); it only ever
--    increases. An acknowledgement records the epoch it was given at and silences a reminder only at the CURRENT
--    epoch, so one recorded before the list last changed can never silence it again, even when the list returns to
--    an earlier state (school cleared then restored, A -> B -> A, a Chair removed and re-added, a role changed away
--    and back). The epoch is advanced by triggers on public.staff, public.committee_staff and public.conference_staff,
--    so it covers staffSchool, the staff command and direct edits alike, in the same transaction as the change.
--    Triggers do not run if session_replication_role is 'replica' (a bulk restore); the acknowledgement's Chair list
--    (section 6) is a second guard that still catches a changed list in that case, though not one that changed and
--    returned. Acknowledgements are append-only history: nothing is deleted or rewritten.
create table public.photo_list_epochs (
 conference_id uuid not null references public.conferences(id),
 committee_id uuid not null, school_id uuid not null,
 epoch bigint not null default 1 check (epoch >= 1),
 updated_at timestamptz not null default now(),
 primary key (committee_id, school_id),
 foreign key (committee_id, conference_id) references public.committees(id, conference_id),
 foreign key (school_id, conference_id) references public.schools(id, conference_id)
);
create index photo_list_epochs_conference on public.photo_list_epochs(conference_id);
alter table public.photo_list_epochs enable row level security;
revoke all on public.photo_list_epochs from anon, authenticated;
grant select on public.photo_list_epochs to authenticated;
create policy read_authorized on public.photo_list_epochs for select to authenticated
 using (private.has_access(conference_id, committee_id, array['admin','chair','observer']::public.conference_role[]));

create function private.advance_photo_epoch(conf uuid, committees uuid[], schools uuid[]) returns void
language sql security definer set search_path='' as $$
 insert into public.photo_list_epochs(conference_id, committee_id, school_id, epoch)
 select distinct conf, c, s, 1 from unnest(committees) c cross join unnest(schools) s where c is not null and s is not null
 on conflict (committee_id, school_id) do update set epoch = public.photo_list_epochs.epoch + 1, updated_at = now();
$$;
revoke all on function private.advance_photo_epoch(uuid,uuid[],uuid[]) from public, anon, authenticated;

-- A Chair with a school changed in the given committees (their lists for that school change).
create function private.photo_epoch_chair(conf uuid, member uuid, committees uuid[]) returns void
language plpgsql security definer set search_path='' as $$
declare school uuid;
begin
 select s."schoolId" into school from public.staff s
  where s.id = member and s.conference_id = conf and exists(select 1 from public.conference_staff f where f.staff_id = member and f.conference_id = conf and f.role = 'chair');
 if school is not null then perform private.advance_photo_epoch(conf, committees, array[school]); end if;
end $$;
revoke all on function private.photo_epoch_chair(uuid,uuid,uuid[]) from public, anon, authenticated;

create function private.photo_epoch_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare member uuid; conf uuid; committees uuid[];
begin
 if tg_table_name = 'staff' then
   -- The school changed: both the old and the new school's lists change in each of the Chair's committees.
   if exists(select 1 from public.conference_staff f where f.staff_id = new.id and f.conference_id = new.conference_id and f.role = 'chair') then
     perform private.advance_photo_epoch(new.conference_id,
       (select coalesce(array_agg(a.committee_id), '{}') from public.committee_staff a where a.staff_id = new.id and a.conference_id = new.conference_id),
       array[old."schoolId", new."schoolId"]);
   end if;
 elsif tg_table_name = 'committee_staff' then
   if tg_op in ('UPDATE', 'DELETE') then perform private.photo_epoch_chair(old.conference_id, old.staff_id, array[old.committee_id]); end if;
   if tg_op in ('UPDATE', 'INSERT') then perform private.photo_epoch_chair(new.conference_id, new.staff_id, array[new.committee_id]); end if;
 else -- conference_staff: a role gained or lost
   if tg_op in ('UPDATE', 'DELETE') then
     if old.role = 'chair' then perform private.photo_epoch_chair(old.conference_id, old.staff_id, (select coalesce(array_agg(a.committee_id), '{}') from public.committee_staff a where a.staff_id = old.staff_id and a.conference_id = old.conference_id)); end if;
   end if;
   if tg_op in ('UPDATE', 'INSERT') then
     if new.role = 'chair' then perform private.photo_epoch_chair(new.conference_id, new.staff_id, (select coalesce(array_agg(a.committee_id), '{}') from public.committee_staff a where a.staff_id = new.staff_id and a.conference_id = new.conference_id)); end if;
   end if;
 end if;
 return null;
end $$;
revoke all on function private.photo_epoch_trigger() from public, anon, authenticated;

create trigger photo_epoch after update of "schoolId" on public.staff
 for each row when (old."schoolId" is distinct from new."schoolId") execute function private.photo_epoch_trigger();
create trigger photo_epoch_ins_del after insert or delete on public.committee_staff
 for each row execute function private.photo_epoch_trigger();
create trigger photo_epoch_upd after update of committee_id, staff_id on public.committee_staff
 for each row when (old.committee_id is distinct from new.committee_id or old.staff_id is distinct from new.staff_id) execute function private.photo_epoch_trigger();
create trigger photo_epoch_ins_del after insert or delete on public.conference_staff
 for each row execute function private.photo_epoch_trigger();
create trigger photo_epoch_upd after update of role, staff_id on public.conference_staff
 for each row when (old.role is distinct from new.role or old.staff_id is distinct from new.staff_id) execute function private.photo_epoch_trigger();

-- 6) An acknowledgement records the epoch (above) and the Chair list (sorted staff ids, '' for none) it was given
--    for. Existing rows default to epoch 0 and '' so they keep their meaning until a Chair list first changes.
--    The old unique key becomes one that includes both, so history of earlier lists is kept alongside.
alter table public.photo_acknowledgements
 add column epoch bigint not null default 0 constraint photo_acknowledgements_epoch_range check (epoch >= 0),
 add column chairs text not null default ''
  constraint photo_acknowledgements_chairs_format check (length(chairs) <= 1850 and
   chairs ~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*)?$');
do $unique$
declare names text[];
begin
 select array_agg(conname) into names from pg_constraint
  where conrelid = 'public.photo_acknowledgements'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) = 'UNIQUE (slot_id, committee_id, stage, slot_revision)';
 if coalesce(array_length(names, 1), 0) <> 1 then raise exception 'photo_acknowledgements unique key changed; review before applying'; end if;
 execute format('alter table public.photo_acknowledgements drop constraint %I', names[1]);
end $unique$;
alter table public.photo_acknowledgements add constraint photo_acknowledgements_once unique (slot_id, committee_id, stage, slot_revision, epoch, chairs);

create or replace function private.ops_photo_ack(conf uuid, cid uuid, actor uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare slot public.photo_slots; chair_list text := coalesce(command->>'chairs', '');
 ack_epoch bigint := coalesce((command->>'epoch')::bigint, 0); rev bigint := (command->>'revision')::bigint; current_epoch bigint;
begin
 select * into slot from public.photo_slots where id = private.uuid_or_null(command->>'slotId') and conference_id = conf;
 if not found then raise exception 'Photo slot unavailable' using errcode='22023'; end if;
 if command->>'stage' not in ('warning','due') then raise exception 'Unknown reminder stage' using errcode='22023'; end if;
 if length(chair_list) > 1850 or chair_list !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*)?$' then
   raise exception 'Unknown Chair list' using errcode='22023';
 end if;
 -- A device cannot have seen an epoch the list has not reached; refuse it so a future epoch can never be pre-recorded.
 -- An older epoch (or revision) is a stale acknowledgement, e.g. queued offline before a Chair change: kept as history,
 -- it never matches the current epoch, so it silences nothing.
 if ack_epoch < 0 then raise exception 'Unknown list version' using errcode='22023'; end if;
 if rev = slot.revision then
   select coalesce(max(e.epoch), 0) into current_epoch from public.photo_list_epochs e where e.committee_id = cid and e.school_id = slot.school_id;
   if ack_epoch > current_epoch then raise exception 'Unknown list version' using errcode='22023'; end if;
 end if;
 insert into public.photo_acknowledgements(conference_id, committee_id, slot_id, stage, slot_revision, epoch, chairs, actor_id)
 values (conf, cid, slot.id, command->>'stage', rev, ack_epoch, chair_list, actor)
 on conflict (slot_id, committee_id, stage, slot_revision, epoch, chairs) do nothing;
 return slot.id;
end; $$;
revoke all on function private.ops_photo_ack(uuid,uuid,uuid,jsonb) from public, anon, authenticated;

-- 7) Wire staffSchool into the operations dispatcher; add photoChairs, photoEpochs and the acknowledgements' epoch and
--    Chair list to the operations snapshot. Each anchor must match exactly once or the migration fails.
create or replace function pg_temp.patch_once(definition text, anchor text, replacement text, label text) returns text language plpgsql as $$
begin
 if (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then raise exception '% changed; review before applying', label; end if;
 return replace(definition, anchor, replacement);
end $$;
do $patch$
declare definition text;
begin
 definition := pg_get_functiondef('private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 definition := pg_temp.patch_once(definition, ' when ''sessionImport'', ''photoSlot'', ''photoImport'' then cid := null;',
  E' when ''sessionImport'', ''photoSlot'', ''photoImport'' then cid := null;\n when ''staffSchool'' then cid := null;', 'apply_operations_mutation scope anchor');
 -- Value-based precondition, mirrored by lib/operations/fingerprint.ts: the Chair's current school or 'none'.
 definition := pg_temp.patch_once(definition, ' elsif kind = ''submissionLink'' then',
  E' elsif kind = ''staffSchool'' then\n   select coalesce("schoolId"::text, ''none'') into actual from public.staff where id = private.uuid_or_null(command->>''staffId'') and conference_id = conf;\n   actual := coalesce(actual, ''none'');\n elsif kind = ''submissionLink'' then', 'apply_operations_mutation stale anchor');
 definition := pg_temp.patch_once(definition, ' when ''photoAck'' then entity := private.ops_photo_ack(conf, cid, actor, command);',
  E' when ''photoAck'' then entity := private.ops_photo_ack(conf, cid, actor, command);\n when ''staffSchool'' then affected := private.ops_staff_school(conf, command); entity := private.uuid_or_null(command->>''staffId'');', 'apply_operations_mutation dispatch anchor');
 execute definition;
 definition := pg_get_functiondef('public.operations_snapshot(uuid)'::regprocedure);
 definition := pg_temp.patch_once(definition, '''revision'',a.slot_revision,''at'',a.created_at)',
  '''revision'',a.slot_revision,''epoch'',a.epoch,''chairs'',a.chairs,''at'',a.created_at)', 'operations_snapshot acknowledgement anchor');
 definition := pg_temp.patch_once(definition, 'from public.photo_acknowledgements a where a.conference_id = conf)',
  E'from public.photo_acknowledgements a where a.conference_id = conf),\n  ''photoChairs'', private.photo_chairs(conf),\n  ''photoEpochs'', (select coalesce(jsonb_agg(jsonb_build_object(''committeeId'',e.committee_id,''schoolId'',e.school_id,''epoch'',e.epoch) order by e.committee_id, e.school_id),''[]'') from public.photo_list_epochs e where e.conference_id = conf)', 'operations_snapshot anchor');
 execute definition;
end $patch$;
