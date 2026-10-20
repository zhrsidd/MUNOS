-- Delegates and Chairs in school group photos (docs/plans/PROTECTED_FEATURES_PLAN.md §2).
-- A Chair may have a school; that school's photo slots then remind the Chair's committees, as delegates do.
-- Additive: one nullable column with a conference-scoped FK, two private helpers, one new operations command.
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

-- 5) Wire the command into the operations dispatcher and photoChairs into the operations snapshot.
do $patch$
declare definition text;
 scope_anchor constant text := ' when ''sessionImport'', ''photoSlot'', ''photoImport'' then cid := null;';
 stale_anchor constant text := ' elsif kind = ''submissionLink'' then';
 dispatch_anchor constant text := ' when ''photoAck'' then entity := private.ops_photo_ack(conf, cid, actor, command);';
 snapshot_anchor constant text := 'from public.photo_acknowledgements a where a.conference_id = conf)';
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
 execute replace(definition, snapshot_anchor, snapshot_anchor || E',\n  ''photoChairs'', private.photo_chairs(conf)');
end $patch$;
