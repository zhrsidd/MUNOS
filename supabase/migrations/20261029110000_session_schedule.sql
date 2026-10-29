-- Session model phase 2 (docs/SESSION_MODEL.md section 12.3 and 12.4): schedule versions, overrides, roll calls, record labels,
-- label corrections, held actions and device clock records, plus the Executive-only commands that write them.
-- PROTECTED CHANGE (schema, RLS, access): needs an independent review and the owner's approval before it is applied anywhere.
--
-- Nothing here changes an existing table, policy, grant or function except two replacements, both fail-closed:
--   * private.session_resolve (phase 1, unapplied) gains one rule: an override that resolves to NO session (a conference-wide
--     override on a slot a committee has no session in) is "no session", flagged, and the schedule is not consulted.
--   * private.apply_operations_mutation gains the five commands below. The patch anchors on exact text and refuses a changed base.
--
-- Access: every new table is read-only to authenticated through RLS; no role has INSERT, UPDATE or DELETE, and service_role has no
-- privilege at all (20261022090000_privilege_hardening). All writes are Executive-only commands inside the existing operations
-- dispatcher, so they inherit its lifecycle lock, receipts, idempotency, audit log and change notifications. Append-only tables also
-- carry triggers that reject UPDATE, DELETE and TRUNCATE.
--
-- Central slots (owner decision, 29 Oct 2026): a conference-scope override names a central slot, not a session id. Each committee
-- resolves it to its own session in that slot; a committee with none shows "No session", flagged.

-- ---- Phase 1 replacement: override that resolves to no session ----------------------------------------------------------
create or replace function private.session_resolve(versions jsonb, overrides jsonb, day_close jsonb, committee text, at timestamptz, tz text default 'Asia/Qatar') returns jsonb
language plpgsql stable set search_path='' as $$
declare
  o record;
  v jsonb;
  wins jsonb;
  hit jsonb;
  nxt timestamptz;
begin
  at := private.session_ms(at);
  select a.sid, a.ends_at into o
    from (
      select e->>'id' id, e->>'scope' scope, e->>'sessionId' sid, private.session_ts(e->>'setAt') set_at,
             least(coalesce(private.session_ts(e->>'expiresAt'), 'infinity'::timestamptz), coalesce(private.session_ts(e->>'endedAt'), 'infinity'::timestamptz),
                   (((private.session_ts(e->>'setAt') at time zone tz)::date + 1)::timestamp at time zone tz)) ends_at,
             (e->>'committeeId') cid
        from jsonb_array_elements(coalesce(overrides, '[]'::jsonb)) e) a
   where (a.scope = 'conference' or a.cid is not distinct from committee) and a.set_at <= at and at < a.ends_at
   order by (a.scope = 'committee') desc, a.set_at desc, a.id collate "C" desc
   limit 1;
  if found then
    return jsonb_build_object('sessionId', o.sid, 'source', 'override', 'flag', case when o.sid is null then 'no_session' else null end,
                              'windowStart', null, 'windowEnd', null, 'nextSwitchAt', private.session_iso(o.ends_at));
  end if;
  v := private.session_version_at(versions, at);
  if v is null or not coalesce((v->>'automationEnabled')::boolean, false) then
    return jsonb_build_object('sessionId', null, 'source', 'none', 'flag', 'no_session', 'windowStart', null, 'windowEnd', null, 'nextSwitchAt', null);
  end if;
  wins := private.session_windows(v->'sessions', (v->>'leadMinutes')::int, (v->>'graceMinutes')::int, day_close, tz);
  select w into hit from jsonb_array_elements(wins) w where private.session_ts(w->>'start') <= at and at < private.session_ts(w->>'end') limit 1;
  nxt := private.session_next_boundary(wins, at);
  return jsonb_build_object(
    'sessionId', hit->>'sessionId',
    'source', 'schedule',
    'flag', case when hit is null then 'outside_schedule' else null end,
    'windowStart', hit->>'start',
    'windowEnd', hit->>'end',
    'nextSwitchAt', case when nxt is null then null else private.session_iso(nxt) end);
end $$;

-- ---- Conference time zone (the database needs the same local midnight the client uses) ----------------------------------
create table private.conference_settings (
  conference_id uuid primary key references public.conferences(id),
  time_zone text not null default 'Asia/Qatar'
);
alter table private.conference_settings enable row level security;
revoke all on private.conference_settings from public, anon, authenticated, service_role;

create function private.conference_time_zone(conf uuid) returns text
language sql stable set search_path='' as $$
  select coalesce((select time_zone from private.conference_settings where conference_id = conf), 'Asia/Qatar')
$$;

-- ---- Append-only guard --------------------------------------------------------------------------------------------------
-- The one exception is the reviewed synthetic-conference cleanup (scripts/cleanup), which sets munos_cleanup.mode = 'execute' inside its
-- transaction and deletes whole synthetic conferences. API roles hold no DELETE privilege, so this only ever concerns the owner.
create function private.reject_append_only_change() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('munos_cleanup.mode', true), '') = 'execute' then return old; end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end $$;

-- ---- schedule_version ---------------------------------------------------------------------------------------------------
create table public.schedule_version (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id),
  committee_id uuid not null,
  effective_from timestamptz not null,
  changed_by uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  lead_minutes integer not null default 5 check (lead_minutes >= 0),
  grace_minutes integer not null default 20 check (grace_minutes >= 0),
  automation_enabled boolean not null,
  -- Snapshot of the committee's central session windows at publish: [{id, slotId, start, end, leadMinutes?}].
  sessions jsonb not null check (jsonb_typeof(sessions) = 'array'),
  created_at timestamptz not null default now(),
  foreign key (committee_id, conference_id) references public.committees(id, conference_id),
  unique (committee_id, effective_from)
);
create index schedule_version_committee on public.schedule_version(committee_id, effective_from desc);

-- ---- session_override and its end events --------------------------------------------------------------------------------
create table public.session_override (
  id uuid primary key,
  conference_id uuid not null references public.conferences(id),
  scope text not null check (scope in ('committee', 'conference')),
  committee_id uuid,
  session_id uuid,
  slot_id uuid,
  -- Conference scope: {committeeId: sessionId | null} captured at creation, one key per active committee, so archiving a slot or a session
  -- later cannot change which session a delayed action is assigned (null = that committee had no session in the slot: "no session").
  targets jsonb,
  set_by uuid not null,
  set_at timestamptz not null,
  -- Committee scope: the next scheduled switch under the version in effect (null when automation is off). Conference scope: null;
  -- each committee derives it from its own versions (private.session_overrides_for), which is deterministic because versions are immutable.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check ((scope = 'committee' and committee_id is not null and session_id is not null and slot_id is null and targets is null)
      or (scope = 'conference' and committee_id is null and session_id is null and slot_id is not null and jsonb_typeof(targets) = 'object')),
  foreign key (committee_id, conference_id) references public.committees(id, conference_id),
  foreign key (session_id, conference_id, committee_id) references public.sessions(id, conference_id, committee_id),
  foreign key (slot_id, conference_id) references public.conference_session_slots(id, conference_id),
  unique (id, conference_id)
);
create index session_override_committee on public.session_override(committee_id, set_at desc);

create table public.session_override_end (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id),
  override_id uuid not null unique,
  committee_id uuid,
  ended_at timestamptz not null,
  ended_reason text not null check (ended_reason in ('automation_enabled')),
  created_at timestamptz not null default now(),
  foreign key (override_id, conference_id) references public.session_override(id, conference_id)
);

-- ---- roll calls (written by phase 5 commands; tables only here) ---------------------------------------------------------
create table public.roll_call (
  id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  conference_id uuid not null references public.conferences(id),
  committee_id uuid not null,
  state text not null check (state in ('draft', 'committed')),
  copied_from uuid,
  observed_at timestamptz not null,
  local_committed_at timestamptz,
  received_at timestamptz not null default now(),
  server_committed_at timestamptz,
  time_confidence text check (time_confidence in ('trusted', 'uncertain')),
  legacy boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  primary key (id, revision),
  foreign key (committee_id, conference_id) references public.committees(id, conference_id),
  unique (id, revision, conference_id, committee_id),
  check (state = 'draft' or (local_committed_at is not null and server_committed_at is not null))
);
create index roll_call_committee on public.roll_call(committee_id, local_committed_at desc);

create table public.roll_call_row (
  roll_call_id uuid not null,
  revision integer not null,
  conference_id uuid not null,
  committee_id uuid not null,
  delegate_id uuid not null,
  status text not null check (status in ('Present', 'Present & Voting', 'Absent')),
  primary key (roll_call_id, revision, delegate_id),
  foreign key (roll_call_id, revision, conference_id, committee_id) references public.roll_call(id, revision, conference_id, committee_id),
  foreign key (delegate_id, conference_id, committee_id) references public.delegates(id, conference_id, committee_id)
);

-- ---- record labels (section 2): the three stored fields; final_label is derived -----------------------------------------
-- A side table keyed by (record_table, record_id) rather than columns on nine core tables: no existing table, snapshot shape or
-- sync contract changes. Phase 3 writes one row per session-bound record at receipt.
create table public.record_label (
  record_table text not null check (record_table ~ '^[a-z_]{1,63}$'),
  record_id uuid not null,
  conference_id uuid not null references public.conferences(id),
  committee_id uuid not null,
  displayed_label uuid,
  assigned_label uuid,
  outside_schedule boolean not null default false,
  time_confidence text check (time_confidence in ('trusted', 'uncertain')),
  device_id uuid,
  device_seq bigint,
  legacy boolean not null default false,
  assigned_at timestamptz not null default now(),
  primary key (record_table, record_id),
  foreign key (committee_id, conference_id) references public.committees(id, conference_id),
  foreign key (displayed_label, conference_id, committee_id) references public.sessions(id, conference_id, committee_id),
  foreign key (assigned_label, conference_id, committee_id) references public.sessions(id, conference_id, committee_id)
);
create index record_label_committee on public.record_label(committee_id);

-- Explicit correction records: "no correction yet" (no row) is distinct from "corrected to no session" (row with a null label).
create table public.label_correction (
  id uuid primary key,
  conference_id uuid not null references public.conferences(id),
  committee_id uuid not null,
  record_table text not null,
  record_id uuid not null,
  corrected_label uuid,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  corrected_by uuid not null,
  corrected_at timestamptz not null default now(),
  foreign key (record_table, record_id) references public.record_label(record_table, record_id),
  foreign key (corrected_label, conference_id, committee_id) references public.sessions(id, conference_id, committee_id)
);
create index label_correction_record on public.label_correction(record_table, record_id, corrected_at desc);

-- ---- held actions (written by phase 3) ----------------------------------------------------------------------------------
create table public.held_action (
  id uuid primary key,
  conference_id uuid not null references public.conferences(id),
  committee_id uuid not null,
  device_id uuid not null,
  device_seq bigint not null,
  actor_id uuid not null,
  requested_role public.conference_role not null,
  command jsonb not null,
  expected text,
  client_time timestamptz,
  received_at timestamptz not null default now(),
  payload_hash text not null,
  time_confidence text check (time_confidence in ('trusted', 'uncertain')),
  reason text not null,
  state text not null default 'held' check (state in ('held', 'applied', 'discarded')),
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  foreign key (committee_id, conference_id) references public.committees(id, conference_id),
  check ((state = 'held' and decided_by is null and decided_at is null) or (state <> 'held' and decided_by is not null and decided_at is not null))
);
create index held_action_open on public.held_action(committee_id, device_id, device_seq) where state = 'held';

-- ---- device clock (section 4) -------------------------------------------------------------------------------------------
create table public.device_clock_sync (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences(id),
  device_id uuid not null,
  actor_id uuid not null,
  conference_day date not null,
  offset_ms bigint not null,
  synced_at timestamptz not null default now()
);
create index device_clock_sync_latest on public.device_clock_sync(conference_id, device_id, conference_day, synced_at desc);

create table public.clock_confirmation (
  id uuid primary key,
  conference_id uuid not null references public.conferences(id),
  device_id uuid not null,
  offset_ms bigint not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now()
);

-- ---- RLS and privileges: SELECT only, through policies -------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['schedule_version', 'session_override', 'session_override_end', 'roll_call', 'roll_call_row', 'record_label',
                           'label_correction', 'held_action', 'device_clock_sync', 'clock_confirmation'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['schedule_version', 'session_override', 'session_override_end', 'label_correction', 'clock_confirmation'] loop
    execute format('create trigger append_only before update or delete on public.%I for each row execute function private.reject_append_only_change()', t);
    execute format('create trigger append_only_truncate before truncate on public.%I for each statement execute function private.reject_append_only_change()', t);
  end loop;
end $$;

-- Committee-bound rows: staff with access to the committee (Chairs their own). Conference-scope rows (committee_id null) and the
-- clock tables: conference-wide grants only; Chair devices receive conference overrides through the snapshot (phase 4).
create policy read_authorized on public.schedule_version for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'approval', 'logistics', 'observer']::public.conference_role[]));
create policy read_authorized on public.session_override for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'approval', 'logistics', 'observer']::public.conference_role[]));
create policy read_authorized on public.session_override_end for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'approval', 'logistics', 'observer']::public.conference_role[]));
-- Roll calls carry delegates' Present / Present & Voting / Absent statuses: the same boundary as attendance (Executive, Chair, observer).
create policy read_authorized on public.roll_call for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'observer']::public.conference_role[]));
create policy read_authorized on public.roll_call_row for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'observer']::public.conference_role[]));
create policy read_authorized on public.record_label for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'approval', 'logistics', 'observer']::public.conference_role[]));
create policy read_authorized on public.label_correction for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair']::public.conference_role[]));
create policy read_authorized on public.held_action for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair']::public.conference_role[]));
create policy read_authorized on public.device_clock_sync for select to authenticated
  using (private.has_access(conference_id, null, array['admin']::public.conference_role[]));
create policy read_authorized on public.clock_confirmation for select to authenticated
  using (private.has_access(conference_id, null, array['admin']::public.conference_role[]));

-- ---- Derived label and read helpers (internal; no API-role EXECUTE) ----------------------------------------------------
-- final_label = the latest explicit correction if there is one (even to null), otherwise the assigned label.
create function private.final_label(table_name text, rid uuid) returns uuid
language sql stable set search_path='' as $$
  select case when c.id is not null then c.corrected_label else l.assigned_label end
    from public.record_label l
    left join lateral (select x.id, x.corrected_label from public.label_correction x
                        where x.record_table = l.record_table and x.record_id = l.record_id
                        order by x.corrected_at desc, x.id desc limit 1) c on true
   where l.record_table = table_name and l.record_id = rid
$$;

create function private.session_versions_for(conf uuid, committee uuid) returns jsonb
language sql stable set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('effectiveFrom', private.session_iso(v.effective_from), 'leadMinutes', v.lead_minutes,
           'graceMinutes', v.grace_minutes, 'automationEnabled', v.automation_enabled, 'sessions', v.sessions) order by v.effective_from), '[]'::jsonb)
    from public.schedule_version v where v.conference_id = conf and v.committee_id = committee
$$;

-- The override log as the pure resolver reads it. A conference-scope override uses the session captured for this committee when it
-- was set (null when it had none; a committee that did not exist then is not covered) and its expiry is derived from this committee's
-- versions at the time it was set.
create function private.session_overrides_for(conf uuid, committee uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  versions jsonb := private.session_versions_for(conf, committee);
  tz text := private.conference_time_zone(conf);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', o.id, 'scope', o.scope, 'committeeId', o.committee_id,
             'sessionId', case o.scope when 'committee' then o.session_id else (o.targets ->> committee::text)::uuid end,
             'setAt', private.session_iso(o.set_at),
             'expiresAt', case o.scope when 'committee' then private.session_iso(o.expires_at)
                            else private.session_iso(private.session_override_expiry(versions, o.set_at, null, tz)) end,
             'endedAt', private.session_iso(e.ended_at)) order by o.set_at, o.id)
      from public.session_override o
      left join public.session_override_end e on e.override_id = o.id
     where o.conference_id = conf and ((o.scope = 'conference' and o.targets ? committee::text) or o.committee_id = committee)), '[]'::jsonb);
end $$;

-- The server's assignment (assigned_label) for a committee at an instant: what phase 3 stamps on records.
create function private.committee_session_at(conf uuid, committee uuid, at timestamptz) returns jsonb
language sql stable set search_path='' as $$
  select private.session_resolve(private.session_versions_for(conf, committee), private.session_overrides_for(conf, committee), null,
                                 committee::text, at, private.conference_time_zone(conf))
$$;

-- ---- Command handlers (called only from private.apply_operations_mutation, which has already checked Executive access) -------
create function private.ops_schedule_snapshot(conf uuid, cid uuid, slot_leads jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r record; out jsonb := '[]'::jsonb; lead integer;
begin
  for r in select s.id, s."slotId" slot_id, s."startsAt" st, s."endsAt" en from public.sessions s
            where s.conference_id = conf and s.committee_id = cid and s."slotId" is not null and not s.archived order by s."startsAt", s.id loop
    if r.en is null then raise exception 'Every central session needs an end time before a schedule is published' using errcode = '22023'; end if;
    lead := case when jsonb_typeof(slot_leads -> r.slot_id::text) = 'number' then (slot_leads ->> r.slot_id::text)::integer end;
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'slotId', r.slot_id,
             'start', private.session_iso(r.st), 'end', private.session_iso(r.en), 'leadMinutes', lead)));
  end loop;
  return out;
end $$;

-- A new version's effective_from: server time at publish, strictly after the committee's previous version.
create function private.next_effective_from(cid uuid) returns timestamptz
language sql volatile set search_path='' as $$
  select greatest(date_trunc('milliseconds', clock_timestamp()), coalesce((select max(effective_from) + interval '1 millisecond' from public.schedule_version where committee_id = cid), '-infinity'::timestamptz))
$$;

-- Enabling automation ends every manual override in scope at that moment, by appending end events (nothing is rewritten).
-- p_committee given: that committee's committee-scope overrides. Null (whole conference): every committee-scope override and the
-- conference-scope ones. Used by every path that turns automation on, whether or not a committee was already on.
create function private.end_overrides(conf uuid, p_committee uuid, eff timestamptz) returns void
language plpgsql set search_path='' as $$
declare tz text := private.conference_time_zone(conf);
begin
  insert into public.session_override_end(conference_id, override_id, committee_id, ended_at, ended_reason)
  select conf, o.id, o.committee_id, eff, 'automation_enabled' from public.session_override o
   where o.conference_id = conf and o.set_at <= eff
     and ((o.scope = 'committee' and (p_committee is null or o.committee_id = p_committee)) or (o.scope = 'conference' and p_committee is null))
     and (o.expires_at is null or o.expires_at > eff)
     and (((o.set_at at time zone tz)::date + 1)::timestamp at time zone tz) > eff
     and not exists (select 1 from public.session_override_end e where e.override_id = o.id);
end $$;

-- scheduleVersion: {committeeId?: uuid (absent = every active committee), leadMinutes?: 5, graceMinutes?: 20, automationEnabled?: true,
--                   slotLeads?: {slotId: minutes}, reason}. All committees publish together or none does. A version that turns
--                   automation on ends the overrides in scope, exactly as automationToggle does.
create function private.ops_schedule_version(conf uuid, actor uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  target uuid := private.uuid_or_null(command->>'committeeId');
  lead integer := coalesce((command->>'leadMinutes')::integer, 5);
  grace integer := coalesce((command->>'graceMinutes')::integer, 20);
  auto boolean := coalesce((command->>'automationEnabled')::boolean, true);
  why text := btrim(command->>'reason');
  c uuid; snapshot jsonb; errors jsonb; eff timestamptz; latest timestamptz; affected uuid[] := '{}';
begin
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if command ? 'slotLeads' and jsonb_typeof(command->'slotLeads') is distinct from 'object' then raise exception 'slotLeads must be an object' using errcode = '22023'; end if;
  for c in select id from public.committees where conference_id = conf and not archived and (target is null or id = target) order by id loop
    snapshot := private.ops_schedule_snapshot(conf, c, command->'slotLeads');
    errors := private.session_schedule_errors(snapshot, lead, grace);
    if jsonb_array_length(errors) > 0 then raise exception 'Schedule rejected: %', errors::text using errcode = '22023'; end if;
    eff := private.next_effective_from(c);
    insert into public.schedule_version(conference_id, committee_id, effective_from, changed_by, reason, lead_minutes, grace_minutes, automation_enabled, sessions)
    values (conf, c, eff, actor, why, lead, grace, auto, snapshot);
    latest := greatest(latest, eff);
    affected := affected || c;
  end loop;
  if target is not null and coalesce(array_length(affected, 1), 0) = 0 then raise exception 'Committee unavailable' using errcode = '22023'; end if;
  if auto and latest is not null then perform private.end_overrides(conf, target, latest); end if;
  return affected;
end $$;

-- automationToggle: {committeeId?: uuid (absent = whole conference), enabled: boolean, reason}. A change of state is a new schedule
-- version that copies the latest one; a toggle to the state a committee is already in writes no version. ENABLING always ends the
-- overrides in scope (see end_overrides), including for committees that were already on, so "enable" reliably means "back to the
-- schedule". A committee with no version cannot be toggled by name; a whole-conference toggle skips it.
create function private.ops_automation_toggle(conf uuid, actor uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  target uuid := private.uuid_or_null(command->>'committeeId');
  want boolean := (command->>'enabled')::boolean;
  why text := btrim(command->>'reason');
  c uuid; prev public.schedule_version; eff timestamptz; latest timestamptz; affected uuid[] := '{}';
begin
  if want is null then raise exception 'enabled must be true or false' using errcode = '22023'; end if;
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if target is not null and not exists (select 1 from public.committees where id = target and conference_id = conf and not archived) then raise exception 'Committee unavailable' using errcode = '22023'; end if;
  for c in select id from public.committees where conference_id = conf and not archived and (target is null or id = target) order by id loop
    select * into prev from public.schedule_version where committee_id = c order by effective_from desc limit 1;
    if not found then
      if target is not null then raise exception 'Publish a schedule for this committee first' using errcode = '22023'; end if;
      continue;
    end if;
    continue when prev.automation_enabled = want;
    eff := private.next_effective_from(c);
    insert into public.schedule_version(conference_id, committee_id, effective_from, changed_by, reason, lead_minutes, grace_minutes, automation_enabled, sessions)
    values (conf, c, eff, actor, why, prev.lead_minutes, prev.grace_minutes, want, prev.sessions);
    latest := greatest(latest, eff);
    affected := affected || c;
  end loop;
  if want then
    perform private.end_overrides(conf, target, coalesce(latest, date_trunc('milliseconds', clock_timestamp())));
    -- Committees whose overrides ended without a new version still need their devices told.
    affected := affected || array(select id from public.committees where conference_id = conf and not archived and (target is null or id = target) and not id = any(affected));
  end if;
  return affected;
end $$;

-- overrideSet: committee scope {scope:'committee', committeeId, sessionId} or conference scope {scope:'conference', slotId}.
-- The override id is the command's deterministic id, so a replay cannot create a second one.
create function private.ops_override_set(conf uuid, actor uuid, new_id uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  scope text := command->>'scope';
  cid uuid := private.uuid_or_null(command->>'committeeId');
  sid uuid := private.uuid_or_null(command->>'sessionId');
  slot uuid := private.uuid_or_null(command->>'slotId');
  at timestamptz := date_trunc('milliseconds', clock_timestamp());
  expiry timestamptz;
begin
  if scope = 'committee' then
    if cid is null or sid is null or slot is not null then raise exception 'A committee override names a committee and one of its sessions' using errcode = '22023'; end if;
    if not exists (select 1 from public.sessions where id = sid and conference_id = conf and committee_id = cid and not archived) then
      raise exception 'Session unavailable' using errcode = '22023';
    end if;
    expiry := private.session_override_expiry(private.session_versions_for(conf, cid), at, null, private.conference_time_zone(conf));
    insert into public.session_override(id, conference_id, scope, committee_id, session_id, set_by, set_at, expires_at)
    values (new_id, conf, 'committee', cid, sid, actor, at, expiry);
    return array[cid];
  end if;
  if slot is null or cid is not null or sid is not null then raise exception 'A conference override names one central slot' using errcode = '22023'; end if;
  if not exists (select 1 from public.conference_session_slots where id = slot and conference_id = conf and not archived) then
    raise exception 'Session slot unavailable' using errcode = '22023';
  end if;
  insert into public.session_override(id, conference_id, scope, slot_id, targets, set_by, set_at)
  values (new_id, conf, 'conference', slot,
          (select coalesce(jsonb_object_agg(c.id::text, (select s.id from public.sessions s where s."slotId" = slot and s.committee_id = c.id and not s.archived)), '{}'::jsonb)
             from public.committees c where c.conference_id = conf and not c.archived),
          actor, at);
  return array(select id from public.committees where conference_id = conf and not archived order by id);
end $$;

-- labelCorrection: {recordTable, recordId, label: uuid|null, reason}. `label` must be present; an explicit null means "no session".
create function private.ops_label_correction(conf uuid, actor uuid, new_id uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  rl public.record_label;
  why text := btrim(command->>'reason');
  new_label uuid := private.uuid_or_null(command->>'label');
begin
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if not command ? 'label' or (jsonb_typeof(command->'label') <> 'null' and new_label is null) then raise exception 'label must be a session id or null' using errcode = '22023'; end if;
  select * into rl from public.record_label where record_table = command->>'recordTable' and record_id = private.uuid_or_null(command->>'recordId') and conference_id = conf;
  if not found then raise exception 'Record unavailable' using errcode = '22023'; end if;
  if new_label is not null and not exists (select 1 from public.sessions where id = new_label and conference_id = conf and committee_id = rl.committee_id) then
    raise exception 'Session unavailable' using errcode = '22023';
  end if;
  insert into public.label_correction(id, conference_id, committee_id, record_table, record_id, corrected_label, reason, corrected_by)
  values (new_id, conf, rl.committee_id, rl.record_table, rl.record_id, new_label, why, actor);
  return array[rl.committee_id];
end $$;

-- clockConfirm: {deviceId, offsetMs, reason}: the Executive confirms one device's clock error (used for bulk approval, phase 3).
create function private.ops_clock_confirm(conf uuid, actor uuid, new_id uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare
  device uuid := private.uuid_or_null(command->>'deviceId');
  off bigint := (command->>'offsetMs')::bigint;
  why text := btrim(command->>'reason');
begin
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if device is null or off is null or abs(off) > 86400000 then raise exception 'Device and an offset within one day are required' using errcode = '22023'; end if;
  if not exists (select 1 from public.device_clock_sync where conference_id = conf and device_id = device) then raise exception 'Device unavailable' using errcode = '22023'; end if;
  insert into public.clock_confirmation(id, conference_id, device_id, offset_ms, reason, confirmed_by) values (new_id, conf, device, off, why, actor);
  return new_id;
end $$;

-- ---- Route the commands through the operations dispatcher ---------------------------------------------------------------
-- Default `allowed` there is Executive (admin) only. These commands additionally require a conference-wide admin grant: an admin scoped
-- to one committee is not the Executive and may not change any schedule.
do $patch$
declare
  definition text;
  anchor_cid text := ' when ''staffSchool'' then cid := null;';
  anchor_run text := ' when ''pointAdjustment'' then entity := private.ops_point_adjustment(conf, cid, actor, new_id, command);';
begin
  definition := pg_get_functiondef('private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
  if (length(definition) - length(replace(definition, anchor_cid, ''))) <> length(anchor_cid) then raise exception 'Operations dispatcher (committee anchor) changed; review session schedule patch'; end if;
  if (length(definition) - length(replace(definition, anchor_run, ''))) <> length(anchor_run) then raise exception 'Operations dispatcher (handler anchor) changed; review session schedule patch'; end if;
  definition := replace(definition, anchor_cid, anchor_cid || chr(10) ||
' when ''scheduleVersion'', ''automationToggle'' then
   if not private.has_access(conf, null, array[''admin'']::public.conference_role[]) then raise exception ''Executive access required'' using errcode=''42501''; end if;
   cid := private.uuid_or_null(command->>''committeeId'');
   if command->>''committeeId'' is not null and (cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf)) then raise exception ''Committee unavailable'' using errcode=''22023''; end if;
 when ''overrideSet'' then
   if not private.has_access(conf, null, array[''admin'']::public.conference_role[]) then raise exception ''Executive access required'' using errcode=''42501''; end if;
   if coalesce(command->>''scope'','''') not in (''committee'',''conference'') then raise exception ''Override scope invalid'' using errcode=''22023''; end if;
   cid := case when command->>''scope'' = ''committee'' then private.uuid_or_null(command->>''committeeId'') end;
   if command->>''scope'' = ''committee'' and (cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf)) then raise exception ''Committee unavailable'' using errcode=''22023''; end if;
 when ''labelCorrection'', ''clockConfirm'' then
   if not private.has_access(conf, null, array[''admin'']::public.conference_role[]) then raise exception ''Executive access required'' using errcode=''42501''; end if;
   cid := null;');
  definition := replace(definition, anchor_run, anchor_run || chr(10) ||
' when ''scheduleVersion'' then affected := private.ops_schedule_version(conf, actor, command);
 when ''automationToggle'' then affected := private.ops_automation_toggle(conf, actor, command);
 when ''overrideSet'' then affected := private.ops_override_set(conf, actor, new_id, command); entity := new_id;
 when ''labelCorrection'' then affected := private.ops_label_correction(conf, actor, new_id, command); entity := new_id;
 when ''clockConfirm'' then entity := private.ops_clock_confirm(conf, actor, new_id, command);');
  execute definition;
end $patch$;

-- Internal helpers: no API-role EXECUTE (new functions have none by default; made explicit here).
revoke all on function private.conference_time_zone(uuid), private.reject_append_only_change(), private.final_label(text, uuid),
  private.session_versions_for(uuid, uuid), private.session_overrides_for(uuid, uuid), private.committee_session_at(uuid, uuid, timestamptz),
  private.ops_schedule_snapshot(uuid, uuid, jsonb), private.next_effective_from(uuid), private.end_overrides(uuid, uuid, timestamptz), private.ops_schedule_version(uuid, uuid, jsonb),
  private.ops_automation_toggle(uuid, uuid, jsonb), private.ops_override_set(uuid, uuid, uuid, jsonb), private.ops_label_correction(uuid, uuid, uuid, jsonb),
  private.ops_clock_confirm(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
