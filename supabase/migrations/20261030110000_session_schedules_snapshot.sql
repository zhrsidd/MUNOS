-- Session model: the schedule a device needs to compute the session it displays (docs/SESSION_MODEL.md section 7). PROTECTED (read model;
-- patches operations_snapshot; unapplied). Evidence only: the server still assigns the label; a device's computed label is sent with each
-- action as command._device.displayedLabel and a difference is flagged for review, never an error to the Chair.
--
-- private.session_schedules(conf) returns one entry per committee the caller can read: its immutable schedule versions and its
-- override log, in the shape lib/sessions/window.ts resolves (a conference-wide override is already mapped to this committee's session,
-- as captured when it was set). It is SECURITY DEFINER so a Chair, whose own grant is committee-scoped, can read the conference-wide
-- overrides that apply to their committee; every committee is checked with private.has_access.
create function private.session_schedules(conf uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'committeeId', c.id, 'timeZone', private.conference_time_zone(conf),
           'versions', private.session_versions_for(conf, c.id), 'overrides', private.session_overrides_for(conf, c.id)) order by c.id), '[]'::jsonb)
    from public.committees c
   where c.conference_id = conf and not c.archived
     and private.has_access(conf, c.id, array['admin', 'chair', 'approval', 'logistics', 'observer']::public.conference_role[])
$$;
revoke all on function private.session_schedules(uuid) from public, anon, service_role;
grant execute on function private.session_schedules(uuid) to authenticated;

-- The hold settings, readable by anyone with a grant in the conference (they shape what a Chair sees: the review notice, the Executive's switch).
create function private.hold_settings(conf uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select case when exists (select 1 from jsonb_array_elements(private.access_grants()) g where (g->>'conference_id')::uuid = conf)
              then jsonb_build_object('enforce', coalesce(s.hold_enforcement, false), 'trustMinutes', coalesce(s.time_trust_minutes, 2), 'staleMinutes', coalesce(s.control_stale_minutes, 5)) end
    from (select 1) one left join private.conference_settings s on s.conference_id = conf
$$;
revoke all on function private.hold_settings(uuid) from public, anon, service_role;
grant execute on function private.hold_settings(uuid) to authenticated;

do $patch$
declare
  definition text;
  anchor constant text := '''dayCloses'',';
begin
  definition := pg_get_functiondef('public.operations_snapshot(uuid)'::regprocedure);
  if (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then raise exception 'operations_snapshot anchor changed; review schedule snapshot patch'; end if;
  execute replace(definition, anchor, '''sessionSchedules'', private.session_schedules(conf), ''holdSettings'', private.hold_settings(conf), ' || anchor);
end $patch$;
