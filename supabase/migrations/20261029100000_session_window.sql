-- Session window rule (docs/SESSION_MODEL.md section 3), phase 1: pure functions only.
--
-- No table, column, policy or RLS change, and no data change. These functions read nothing from the database: every input is a
-- parameter, so they are STABLE (time zone lookups) and have no side effects. They are the SQL twin of lib/sessions/window.ts;
-- both run the shared vectors in tests/fixtures/session-window-vectors.json (tests/session-window.test.ts and
-- tests/session-window-db.test.ts). Change one, change the other.
--
-- Privileges: they live in schema private and are deliberately NOT granted to anon, authenticated or service_role
-- (20261022090000_privilege_hardening: new functions have no API-role EXECUTE by default). Later phase 2 and 3 security-definer
-- RPCs, owned by the migration owner, call them. They are not an API surface.
--
--   switch(Sk) = max(start(Sk) - lead, end(S(k-1)))         first session of a day: start - lead
--   window(Sk) = [switch(Sk), switch(S(k+1)))
--   last session of a day: [switch, close), close = min(Executive close-day, end + grace, next local midnight)
--   a window never crosses a local midnight; lead and grace are parameters (grace is a PROPOSED value, not a rule).

create or replace function private.session_iso(ts timestamptz) returns text
language sql stable set search_path='' as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Publish-time validation: a sorted array of error codes, empty when the schedule is valid.
create or replace function private.session_schedule_errors(sessions jsonb, lead_minutes int, grace_minutes int) returns jsonb
language plpgsql stable set search_path='' as $$
declare
  errs text[] := '{}';
  prev_start timestamptz;
  prev_end timestamptz;
  r record;
begin
  if lead_minutes < 0 or exists (select 1 from jsonb_array_elements(sessions) e where e->>'leadMinutes' is not null and (e->>'leadMinutes')::int < 0) then
    errs := array_append(errs, 'negative_lead'::text);
  end if;
  if grace_minutes < 0 then errs := array_append(errs, 'negative_grace'::text); end if;
  for r in select (e->>'start')::timestamptz s, (e->>'end')::timestamptz f from jsonb_array_elements(sessions) e order by 1, 2 loop
    if not (r.s < r.f) then errs := array_append(errs, 'start_not_before_end'::text); end if;
    if prev_start is not null then
      if r.s = prev_start then errs := array_append(errs, 'identical_start'::text);
      elsif r.s < prev_end then errs := array_append(errs, 'overlap'::text);
      end if;
    end if;
    prev_start := r.s;
    prev_end := r.f;
  end loop;
  return coalesce((select jsonb_agg(x order by x collate "C") from (select distinct unnest(errs) x) q), '[]'::jsonb);
end $$;

-- Every window of a valid schedule, in time order, as [{sessionId, start, end}]. Empty windows are dropped.
-- sessions: [{id, start, end, leadMinutes?}]; day_close: {"YYYY-MM-DD": instant} keyed by local date (or null).
create or replace function private.session_windows(sessions jsonb, lead_minutes int, grace_minutes int, day_close jsonb default null, tz text default 'Asia/Qatar') returns jsonb
language plpgsql stable set search_path='' as $$
declare
  r record;
  out jsonb := '[]'::jsonb;
begin
  for r in
    with s as (
      select e->>'id' id, (e->>'start')::timestamptz st, (e->>'end')::timestamptz en,
             coalesce((e->>'leadMinutes')::int, lead_minutes) ld,
             ((e->>'start')::timestamptz at time zone tz)::date d
        from jsonb_array_elements(sessions) e),
    b as (
      select s.*, (s.d::timestamp at time zone tz) day_start, ((s.d + 1)::timestamp at time zone tz) midnight,
             row_number() over w rn, lag(s.en) over w prev_end
        from s window w as (partition by s.d order by s.st)),
    sw as (
      select b.*, greatest(case when rn = 1 then st - ld * interval '1 minute' else greatest(st - ld * interval '1 minute', prev_end) end, day_start) sw_at from b),
    w as (
      select sw.*, lead(sw_at) over (partition by d order by st) next_sw from sw)
    select id, sw_at,
           coalesce(next_sw, least(en + grace_minutes * interval '1 minute', midnight, coalesce((day_close->>to_char(d, 'YYYY-MM-DD'))::timestamptz, 'infinity'::timestamptz))) end_at
      from w order by st
  loop
    if r.end_at > r.sw_at then
      out := out || jsonb_build_object('sessionId', r.id, 'start', private.session_iso(r.sw_at), 'end', private.session_iso(r.end_at));
    end if;
  end loop;
  return out;
end $$;

-- The version with the greatest effective_from not later than `at` (a later array entry wins a tie); null if none.
create or replace function private.session_version_at(versions jsonb, at timestamptz) returns jsonb
language sql stable set search_path='' as $$
  select e from jsonb_array_elements(versions) with ordinality t(e, ord)
   where (e->>'effectiveFrom')::timestamptz <= at
   order by (e->>'effectiveFrom')::timestamptz desc, ord desc limit 1
$$;

-- The next window edge strictly after `at`; null if none.
create or replace function private.session_next_boundary(windows jsonb, at timestamptz) returns timestamptz
language sql stable set search_path='' as $$
  select min(x) from (
    select (w->>'start')::timestamptz x from jsonb_array_elements(windows) w
    union all
    select (w->>'end')::timestamptz from jsonb_array_elements(windows) w) q
   where x > at
$$;

-- The expiry stored when an override is created: the next scheduled switch under the version in effect, or null when
-- automation is off or no version exists. (Every override is also capped at local midnight by session_resolve.)
create or replace function private.session_override_expiry(versions jsonb, set_at timestamptz, day_close jsonb default null, tz text default 'Asia/Qatar') returns timestamptz
language plpgsql stable set search_path='' as $$
declare
  v jsonb := private.session_version_at(versions, set_at);
begin
  if v is null or not coalesce((v->>'automationEnabled')::boolean, false) then return null; end if;
  return private.session_next_boundary(private.session_windows(v->'sessions', (v->>'leadMinutes')::int, (v->>'graceMinutes')::int, day_close, tz), set_at);
end $$;

-- The label for a committee at `at`, from the versions and override log as they were then.
-- overrides: [{id, scope, committeeId?, sessionId, setAt, expiresAt?, endedAt?}] (end events folded into endedAt).
-- Returns {sessionId, source: schedule|override|none, flag: outside_schedule|no_session|null, windowStart, windowEnd, nextSwitchAt}.
create or replace function private.session_resolve(versions jsonb, overrides jsonb, day_close jsonb, committee text, at timestamptz, tz text default 'Asia/Qatar') returns jsonb
language plpgsql stable set search_path='' as $$
declare
  o record;
  v jsonb;
  wins jsonb;
  hit jsonb;
  nxt timestamptz;
begin
  select a.sid, a.ends_at into o
    from (
      select e->>'id' id, e->>'scope' scope, e->>'sessionId' sid, (e->>'setAt')::timestamptz set_at,
             least(coalesce((e->>'expiresAt')::timestamptz, 'infinity'::timestamptz), coalesce((e->>'endedAt')::timestamptz, 'infinity'::timestamptz),
                   ((((e->>'setAt')::timestamptz at time zone tz)::date + 1)::timestamp at time zone tz)) ends_at,
             (e->>'committeeId') cid
        from jsonb_array_elements(coalesce(overrides, '[]'::jsonb)) e) a
   where (a.scope = 'conference' or a.cid is not distinct from committee) and a.set_at <= at and at < a.ends_at
   order by (a.scope = 'committee') desc, a.set_at desc, a.id collate "C" desc
   limit 1;
  if found then
    return jsonb_build_object('sessionId', o.sid, 'source', 'override', 'flag', null, 'windowStart', null, 'windowEnd', null, 'nextSwitchAt', private.session_iso(o.ends_at));
  end if;
  v := private.session_version_at(versions, at);
  if v is null or not coalesce((v->>'automationEnabled')::boolean, false) then
    return jsonb_build_object('sessionId', null, 'source', 'none', 'flag', 'no_session', 'windowStart', null, 'windowEnd', null, 'nextSwitchAt', null);
  end if;
  wins := private.session_windows(v->'sessions', (v->>'leadMinutes')::int, (v->>'graceMinutes')::int, day_close, tz);
  select w into hit from jsonb_array_elements(wins) w where (w->>'start')::timestamptz <= at and at < (w->>'end')::timestamptz limit 1;
  nxt := private.session_next_boundary(wins, at);
  return jsonb_build_object(
    'sessionId', hit->>'sessionId',
    'source', 'schedule',
    'flag', case when hit is null then 'outside_schedule' else null end,
    'windowStart', hit->>'start',
    'windowEnd', hit->>'end',
    'nextSwitchAt', case when nxt is null then null else private.session_iso(nxt) end);
end $$;
