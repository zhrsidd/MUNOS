-- Delegates and Chairs in school group photos (docs/plans/PROTECTED_FEATURES_PLAN.md §2).
-- A Chair may have a school; that school's photo slots then remind the Chair's committees, as delegates do.
-- One nullable column with a conference-scoped FK, two private helpers, one new operations command, and a Chair-list
-- version on photo acknowledgements so a changed list is reminded again (section 5: one defaulted column, and the
-- acknowledgement unique key becomes an index because acknowledgements are append-only history).
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

-- 5) An acknowledgement is for one Chair list as well as one slot revision. `chairs` holds the sorted staff ids of
--    the committee's Chairs in that photo as the acknowledging device showed them (photoChairsVersion in
--    lib/operations/photo-reminders.ts); '' is no Chairs, so existing acknowledgements keep their meaning. The list
--    is derived from current data, so it changes with every kind of change to a Chair's school, committees or role
--    (staffSchool, the staff command, direct edits). A reminder is silenced only while the LATEST acknowledgement of
--    that slot revision and stage is for the current list. So an earlier acknowledgement no longer silences a changed
--    list, even if the list later changes back, and a stale acknowledgement queued offline is recorded as history but
--    cannot silence the updated list. Append-only: a row is added whenever the latest one's list differs (so the
--    unique key is replaced by an index); rows are never deleted or rewritten. apply_operations_mutation locks the
--    committee row first, so acknowledgements of one committee are serialised and clock_timestamp() orders them.
alter table public.photo_acknowledgements add column chairs text not null default ''
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
create index photo_acknowledgements_latest on public.photo_acknowledgements(slot_id, committee_id, stage, slot_revision, created_at);

create or replace function private.ops_photo_ack(conf uuid, cid uuid, actor uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare slot public.photo_slots; chair_list text := coalesce(command->>'chairs', '');
begin
 select * into slot from public.photo_slots where id = private.uuid_or_null(command->>'slotId') and conference_id = conf;
 if not found then raise exception 'Photo slot unavailable' using errcode='22023'; end if;
 if command->>'stage' not in ('warning','due') then raise exception 'Unknown reminder stage' using errcode='22023'; end if;
 if length(chair_list) > 1850 or chair_list !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*)?$' then
   raise exception 'Unknown Chair list' using errcode='22023';
 end if;
 -- Acknowledging an older revision or Chair list is harmless: it is kept as history and does not silence the
 -- current reminder (the client compares revision and the latest Chair list, lib/operations/photo-reminders.ts).
 -- A repeat of the latest acknowledgement adds nothing.
 if (select a.chairs from public.photo_acknowledgements a
     where a.slot_id = slot.id and a.committee_id = cid and a.stage = command->>'stage' and a.slot_revision = (command->>'revision')::bigint
     order by a.created_at desc, a.id desc limit 1) is distinct from chair_list then
   insert into public.photo_acknowledgements(conference_id, committee_id, slot_id, stage, slot_revision, chairs, actor_id, created_at, updated_at)
   values (conf, cid, slot.id, command->>'stage', (command->>'revision')::bigint, chair_list, actor, clock_timestamp(), clock_timestamp());
 end if;
 return slot.id;
end; $$;
revoke all on function private.ops_photo_ack(uuid,uuid,uuid,jsonb) from public, anon, authenticated;

-- 6) Wire the command into the operations dispatcher, and photoChairs and acknowledgement Chair lists into the
--    operations snapshot.
do $patch$
declare definition text;
 scope_anchor constant text := ' when ''sessionImport'', ''photoSlot'', ''photoImport'' then cid := null;';
 stale_anchor constant text := ' elsif kind = ''submissionLink'' then';
 dispatch_anchor constant text := ' when ''photoAck'' then entity := private.ops_photo_ack(conf, cid, actor, command);';
 snapshot_anchor constant text := 'from public.photo_acknowledgements a where a.conference_id = conf)';
 ack_anchor constant text := '''revision'',a.slot_revision,''at'',a.created_at) order by a.created_at)';
begin
 definition := pg_get_functiondef('private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 if length(definition) - length(replace(definition, scope_anchor, '')) <> length(scope_anchor) then raise exception 'apply_operations_mutation scope anchor changed; review before applying'; end if;
 if length(definition) - length(replace(definition, stale_anchor, '')) <> length(stale_anchor) then raise exception 'apply_operations_mutation stale anchor changed; review before applying'; end if;
 if length(definition) - length(replace(definition, dispatch_anchor, '')) <> length(dispatch_anchor) then raise exception 'apply_operations_mutation dispatch anchor changed; review before applying'; end if;
 definition := replace(definition, scope_anchor, scope_anchor || E'\n when ''staffSchool'' then cid := null;');
 -- Value-based precondition, mirrored by lib/operations/fingerprint.ts: the Chair's current school or 'none'.
 definition := replace(definition, stale_anchor, E' elsif kind = ''staffSchool'' then\n   select coalesce("schoolId"::text, ''none'') into actual from public.staff where id = private.uuid_or_null(command->>''staffId'') and conference_id = conf;\n   actual := coalesce(actual, ''none'');\n' || stale_anchor);
 definition := replace(definition, dispatch_anchor, dispatch_anchor || E'\n when ''staffSchool'' then affected := private.ops_staff_school(conf, command); entity := private.uuid_or_null(command->>''staffId'');');
 execute definition;
 definition := pg_get_functiondef('public.operations_snapshot(uuid)'::regprocedure);
 if length(definition) - length(replace(definition, snapshot_anchor, '')) <> length(snapshot_anchor) then raise exception 'operations_snapshot anchor changed; review before applying'; end if;
 if length(definition) - length(replace(definition, ack_anchor, '')) <> length(ack_anchor) then raise exception 'operations_snapshot acknowledgement anchor changed; review before applying'; end if;
 -- Recorded order (the client's "latest acknowledgement" relies on it), with the same tie-break as ops_photo_ack.
 definition := replace(definition, ack_anchor, '''revision'',a.slot_revision,''chairs'',a.chairs,''at'',a.created_at) order by a.created_at, a.id)');
 execute replace(definition, snapshot_anchor, snapshot_anchor || E',\n  ''photoChairs'', private.photo_chairs(conf)');
end $patch$;
