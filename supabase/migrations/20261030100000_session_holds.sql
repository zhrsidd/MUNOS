-- Session model phase 3b + device protocol (docs/SESSION_MODEL.md sections 4, 5 and 12.5): hold rules, held-behind ordering, Executive review,
-- day close, and the device clock call. PROTECTED change (patches the three Chair write dispatchers and operations_snapshot; unapplied).
--
-- Hold rules apply ONLY to a Chair's Record and Control commands, and ONLY when the Executive has switched enforcement on for the
-- conference (conference_settings.hold_enforcement, default off, command holdSettings). With it off every command behaves as before
-- and is only labelled (20261030090000). Reason: with no schedule published a committee has "no session", and enforcing would hold
-- every Control command; the Executive turns enforcement on once schedules are published and devices send the protocol block.
--
--   Record  (participation, event, vote, speechScore, poiScore, pointAdjustment): applied when the time is Trusted (label and flags
--           per section 2); HELD when the time is Uncertain or the conference day was closed before it arrived.
--   Control (queue*, debateMode, speech*, poi*, voteMode, document): applied when Trusted, inside a window, not stale (received within
--           control_stale_minutes of its device time), not behind a held earlier command from the same device and committee; else HELD.
--   Held actions are RECEIVED (acknowledged, never lost) and park in public.held_action with the original command. The Executive
--   approves (the original command runs once, as its ORIGINAL actor, under that actor's CURRENT permissions and the current entity
--   revision) or discards, one at a time or per device after confirming the device's clock error. Approving keeps the Executive's
--   own audit row; the applied effect carries the original actor's.

-- ---- Published schedule history cannot be deleted --------------------------------------------------------------------------
create function private.reject_published_session_delete() returns trigger
language plpgsql set search_path='' as $$
begin
  if coalesce(current_setting('munos_cleanup.mode', true), '') = 'execute' then return old; end if;
  if exists (select 1 from public.schedule_version v where v.committee_id = old.committee_id and v.sessions @> jsonb_build_array(jsonb_build_object('id', old.id))) then
    raise exception 'A published schedule refers to this session; archive it instead of deleting it' using errcode = '22023';
  end if;
  return old;
end $$;
create trigger published_session_guard before delete on public.sessions for each row execute function private.reject_published_session_delete();

-- ---- Settings and columns -------------------------------------------------------------------------------------------------
alter table private.conference_settings
  add column hold_enforcement boolean not null default false,
  add column control_stale_minutes integer not null default 5 check (control_stale_minutes between 1 and 120);

alter table public.held_action
  alter column device_id drop not null,
  alter column device_seq drop not null,
  add column last_error text;

-- ---- Executive "close day" -------------------------------------------------------------------------------------------------
create table public.conference_day_close (
  id uuid primary key,
  conference_id uuid not null references public.conferences(id),
  conference_day date not null,
  closed_at timestamptz not null,
  closed_by uuid not null,
  reason text not null check (length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (conference_id, conference_day)
);
alter table public.conference_day_close enable row level security;
revoke all on public.conference_day_close from public, anon, authenticated, service_role;
grant select on public.conference_day_close to authenticated;
create policy read_authorized on public.conference_day_close for select to authenticated using (private.has_access(conference_id, null, array['admin']::public.conference_role[]));
create trigger append_only before update or delete on public.conference_day_close for each row execute function private.reject_append_only_change();
create trigger append_only_truncate before truncate on public.conference_day_close for each statement execute function private.reject_append_only_change();

-- The assignment now also honours the Executive's close-day instants (they cap the last window of that day).
create or replace function private.committee_session_at(conf uuid, committee uuid, at timestamptz) returns jsonb
language sql stable set search_path='' as $$
  select private.session_resolve(private.session_versions_for(conf, committee), private.session_overrides_for(conf, committee),
           (select coalesce(jsonb_object_agg(to_char(c.conference_day, 'YYYY-MM-DD'), private.session_iso(c.closed_at)), '{}'::jsonb) from public.conference_day_close c where c.conference_id = conf),
           committee::text, at, private.conference_time_zone(conf))
$$;

-- ---- Classification ---------------------------------------------------------------------------------------------------------
create function private.command_class(kind text) returns text
language sql immutable set search_path='' as $$
  select case
    when kind in ('participation', 'event', 'vote', 'speechScore', 'poiScore', 'pointAdjustment') then 'record'
    when kind in ('queue', 'queueAdd', 'queueOrder', 'queueRemove', 'debateMode', 'speechStart', 'speechYield', 'speechFinish', 'poiAllowance', 'poiAdd',
                  'poiOrder', 'poiRecognize', 'poiRemove', 'voteMode', 'document') then 'control'
  end
$$;

create function private.payload_hash(command jsonb, requested_role public.conference_role, expected text, client_time timestamptz) returns text
language sql stable set search_path='' as $$
  select encode(sha256(convert_to(jsonb_build_object('command', command, 'role', requested_role, 'expected', expected, 'client_time', client_time)::text, 'UTF8')), 'hex')
$$;

-- A command already received and held: acknowledge it again with no effect. Runs before any permission check so an exact retry of
-- something accepted earlier is acknowledged even if access has since changed (AGENTS.md, 22 Oct 2026). An approval re-run bypasses it.
create function private.held_replay(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz) returns boolean
language plpgsql set search_path='' as $$
declare h public.held_action; actor uuid := auth.uid();
begin
  if coalesce(current_setting('munos.approving', true), '') = mutation::text then return false; end if;
  select * into h from public.held_action where id = mutation;
  if not found then return false; end if;
  if actor is null or h.actor_id <> actor or h.conference_id <> conf or h.payload_hash <> private.payload_hash(command, requested_role, expected, client_time) then
    raise exception 'Idempotency key reused for a different action' using errcode = '22023';
  end if;
  return true;
end $$;

-- The hold decision, after the caller's access to the committee is established and its row is locked. True = parked, nothing applied.
create function private.hold_gate(conf uuid, cid uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz) returns boolean
language plpgsql set search_path='' as $$
declare
  kind text := command->>'type';
  cls text := private.command_class(kind);
  st private.conference_settings;
  ctx jsonb := nullif(current_setting('munos.mutation_ctx', true), '')::jsonb;
  tz text := private.conference_time_zone(conf);
  received timestamptz; device uuid; seq bigint; confidence text; acted timestamptz; why text;
begin
  if coalesce(current_setting('munos.approving', true), '') = mutation::text then return false; end if;
  if cls is null or requested_role <> 'chair' or cid is null or ctx is null then return false; end if;
  select * into st from private.conference_settings where conference_id = conf;
  if not found or not st.hold_enforcement then return false; end if;
  received := private.session_ts(ctx->>'receivedAt');
  device := private.uuid_or_null(ctx->>'deviceId');
  seq := (ctx->>'deviceSeq')::bigint;
  confidence := private.time_confidence(conf, device, client_time, received);
  acted := case when confidence = 'trusted' then client_time else received end;
  if exists (select 1 from public.conference_day_close c where c.conference_id = conf and c.conference_day = (acted at time zone tz)::date and c.closed_at <= received) then
    why := 'day_closed';
  elsif confidence = 'uncertain' then
    why := 'uncertain_time';
  elsif cls = 'control' then
    if private.committee_session_at(conf, cid, acted)->>'flag' is not null then why := 'outside_window';
    elsif received - client_time > make_interval(mins => st.control_stale_minutes) then why := 'stale';
    elsif device is not null and seq is not null and exists (
            select 1 from public.held_action h where h.state = 'held' and h.committee_id = cid and h.device_id = device and h.device_seq < seq
               and private.command_class(h.command->>'type') = 'control') then why := 'behind_held';
    end if;
  end if;
  if why is null then return false; end if;
  insert into public.held_action(id, conference_id, committee_id, device_id, device_seq, actor_id, requested_role, command, expected, client_time, received_at, payload_hash, time_confidence, reason)
  values (mutation, conf, cid, device, seq, auth.uid(), requested_role, command, expected, client_time, received,
          private.payload_hash(command, requested_role, expected, client_time), confidence, why);
  insert into public.audit_log(conference_id, committee_id, "actorId", action, "entityId", mutation_id, details)
  values (conf, cid, auth.uid(), 'Held for review', mutation, gen_random_uuid(), jsonb_build_object('type', kind, 'reason', why, 'heldAction', mutation));
  insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, cid, 'chair', gen_random_uuid());
  return true;
end $$;

-- ---- Approval: re-run the ORIGINAL command as its original actor ------------------------------------------------------------
-- The dispatchers read the caller from auth.uid(). For the duration of one approval the transaction-local claim is switched to the
-- original actor, so the original actor's CURRENT grants (including revocation) decide, and the receipt, audit row and effect carry
-- that actor. It is restored before returning. Reachable only from the Executive commands below.
-- Returns null on success, otherwise a reason code; on failure the item stays held with that reason and nothing was applied.
create function private.run_held(h public.held_action, offset_ms bigint) returns text
language plpgsql set search_path='' as $$
declare
  caller text := coalesce(current_setting('request.jwt.claim.sub', true), '');
  kind text := h.command->>'type';
  code text; msg text;
begin
  perform set_config('munos.approving', h.id::text, true);
  perform set_config('munos.approval_offset', coalesce(offset_ms::text, ''), true);
  perform set_config('request.jwt.claim.sub', h.actor_id::text, true);
  begin
    if kind = 'pointAdjustment' then
      perform private.apply_operations_mutation(h.conference_id, h.id, h.command, h.requested_role, h.expected, h.client_time);
    elsif kind in ('currentSession', 'debateMode', 'queueAdd', 'queueOrder', 'queueRemove', 'speechStart', 'speechYield', 'speechScore', 'speechFinish', 'poiAllowance',
                   'poiAdd', 'poiOrder', 'poiRecognize', 'poiScore', 'poiRemove', 'voteMode', 'vetoRules') then
      perform private.apply_procedure(h.conference_id, h.id, h.command, h.requested_role, h.expected, h.client_time);
    else
      perform private.apply_mutation(h.conference_id, h.id, h.command, h.requested_role, h.expected, h.client_time);
    end if;
    code := null;
  exception when others then
    get stacked diagnostics msg = message_text;
    code := case sqlstate when 'PT409' then 'revision_mismatch' when '42501' then 'actor_not_authorised' else 'not_applicable' end;
    update public.held_action set reason = code, last_error = left(msg, 500) where id = h.id;
  end;
  perform set_config('request.jwt.claim.sub', caller, true);
  perform set_config('munos.approving', '', true);
  perform set_config('munos.approval_offset', '', true);
  return code;
end $$;

-- heldDecide: {heldId, decision: 'approve' | 'discard', reason}
create function private.ops_held_decide(conf uuid, actor uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  h public.held_action;
  decision text := command->>'decision';
  why text := btrim(command->>'reason');
  hid uuid := private.uuid_or_null(command->>'heldId');
begin
  if decision not in ('approve', 'discard') then raise exception 'decision must be approve or discard' using errcode = '22023'; end if;
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into h from public.held_action where id = hid and conference_id = conf for update;
  if not found then raise exception 'Held action unavailable' using errcode = '22023'; end if;
  if h.state <> 'held' then raise exception 'This action has already been decided' using errcode = '22023'; end if;
  if decision = 'approve' and private.run_held(h, null) is not null then return array[h.committee_id]; end if;
  update public.held_action set state = case decision when 'approve' then 'applied' else 'discarded' end, decided_by = actor, decided_at = now(), decision_reason = why where id = h.id;
  return array[h.committee_id];
end $$;

-- heldBulkApprove: {deviceId, reason}: approve a device's items held for its clock (uncertain_time, or behind one), in device order,
-- with the clock error the Executive confirmed (clockConfirm). Each item is independent: one that cannot apply stays held with its reason.
create function private.ops_held_bulk_approve(conf uuid, actor uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  device uuid := private.uuid_or_null(command->>'deviceId');
  why text := btrim(command->>'reason');
  off bigint; h public.held_action; affected uuid[] := '{}';
begin
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if device is null then raise exception 'deviceId is required' using errcode = '22023'; end if;
  select offset_ms into off from public.clock_confirmation where conference_id = conf and device_id = device order by confirmed_at desc, id desc limit 1;
  if off is null then raise exception 'Confirm this device''s clock error first' using errcode = '22023'; end if;
  for h in select * from public.held_action where conference_id = conf and device_id = device and state = 'held' and reason in ('uncertain_time', 'behind_held')
            order by device_seq nulls last, received_at, id for update loop
    if private.run_held(h, off) is null then
      update public.held_action set state = 'applied', decided_by = actor, decided_at = now(), decision_reason = why where id = h.id;
    end if;
    if not h.committee_id = any(affected) then affected := affected || h.committee_id; end if;
  end loop;
  return affected;
end $$;

-- closeDay: {day?: 'YYYY-MM-DD' (default today in the conference zone), reason}. One-way: a closed day's late arrivals are held.
create function private.ops_close_day(conf uuid, actor uuid, new_id uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  tz text := private.conference_time_zone(conf);
  d date := coalesce(nullif(command->>'day', '')::date, (clock_timestamp() at time zone tz)::date);
  why text := btrim(command->>'reason');
begin
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  if exists (select 1 from public.conference_day_close where conference_id = conf and conference_day = d) then raise exception 'This day is already closed' using errcode = '22023'; end if;
  insert into public.conference_day_close(id, conference_id, conference_day, closed_at, closed_by, reason)
  values (new_id, conf, d, date_trunc('milliseconds', clock_timestamp()), actor, why);
  return array(select id from public.committees where conference_id = conf and not archived order by id);
end $$;

-- holdSettings: {enforce?: boolean, trustMinutes?: 0..60, staleMinutes?: 1..120}. Absent keys are left as they are.
create function private.ops_hold_settings(conf uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  enforce boolean := (command->>'enforce')::boolean;
  trust integer := (command->>'trustMinutes')::integer;
  stale integer := (command->>'staleMinutes')::integer;
begin
  if enforce is null and trust is null and stale is null then raise exception 'Nothing to change' using errcode = '22023'; end if;
  insert into private.conference_settings(conference_id, hold_enforcement, time_trust_minutes, control_stale_minutes)
  values (conf, coalesce(enforce, false), coalesce(trust, 2), coalesce(stale, 5))
  on conflict (conference_id) do update set
    hold_enforcement = coalesce(enforce, private.conference_settings.hold_enforcement),
    time_trust_minutes = coalesce(trust, private.conference_settings.time_trust_minutes),
    control_stale_minutes = coalesce(stale, private.conference_settings.control_stale_minutes);
  return array(select id from public.committees where conference_id = conf and not archived order by id);
end $$;

-- ---- Device protocol: the device's clock offset (section 4) -----------------------------------------------------------------
-- A device calls this on start and on every reconnect, before it flushes its outbox. offset_ms = device time - server time.
-- Any holder of an active grant in the conference may report their own device; at most one row per device per minute.
create function private.record_device_clock(conf uuid, device uuid, device_time timestamptz) returns bigint
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  tz text := private.conference_time_zone(conf);
  server timestamptz := date_trunc('milliseconds', clock_timestamp());
  off bigint;
begin
  perform private.lock_lifecycle();
  if actor is null or device is null or device_time is null then raise exception 'Session required' using errcode = '42501'; end if;
  if not exists (select 1 from jsonb_array_elements(private.access_grants()) g where (g->>'conference_id')::uuid = conf) then raise exception 'Conference access has not been granted' using errcode = '42501'; end if;
  off := round(extract(epoch from (device_time - server)) * 1000)::bigint;
  if not exists (select 1 from public.device_clock_sync where conference_id = conf and device_id = device and synced_at > server - interval '1 minute') then
    insert into public.device_clock_sync(conference_id, device_id, actor_id, conference_day, offset_ms, synced_at)
    values (conf, device, actor, (server at time zone tz)::date, off, server);
  end if;
  return off;
end $$;
create function public.record_device_clock(conf uuid, device uuid, device_time timestamptz) returns bigint
language sql security invoker set search_path='' as $$ select private.record_device_clock(conf, device, device_time) $$;
revoke all on function public.record_device_clock(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.record_device_clock(uuid, uuid, timestamptz) to authenticated;
revoke all on function private.record_device_clock(uuid, uuid, timestamptz) from public, anon;
grant execute on function private.record_device_clock(uuid, uuid, timestamptz) to authenticated;

-- ---- Wire the dispatchers --------------------------------------------------------------------------------------------------
do $patch$
declare
  signature text;
  definition text;
  lock_anchor constant text := ' perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));';
  gate_anchor text;
  gate_call constant text := ' if private.hold_gate(conf, cid, mutation, command, requested_role, expected, client_time) then return; end if;';
  replay_call constant text := ' if private.held_replay(conf, mutation, command, requested_role, expected, client_time) then return; end if;';
begin
  foreach signature in array array[
    'private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
    'private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
    'private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    gate_anchor := case
      when signature like 'private.apply_mutation%' then ' else perform 1 from public.conferences where id=conf for update; end if;'
      when signature like 'private.apply_procedure%' then ' perform 1 from public.committees where id=cid for update;'
      else ' else perform 1 from public.conferences where id = conf for update; end if;' end;
    if (length(definition) - length(replace(definition, lock_anchor, ''))) <> length(lock_anchor) then raise exception '% mutation-lock anchor changed; review hold patch', signature; end if;
    if (length(definition) - length(replace(definition, gate_anchor, ''))) <> length(gate_anchor) then raise exception '% committee-lock anchor changed; review hold patch', signature; end if;
    definition := replace(definition, lock_anchor, lock_anchor || chr(10) || replay_call);
    definition := replace(definition, gate_anchor, gate_anchor || chr(10) || gate_call);
    execute definition;
  end loop;
end $patch$;

-- The Executive commands, through the operations dispatcher (default `allowed` there is admin; a conference-wide admin grant is required).
do $patch$
declare
  definition text;
  anchor_cid text := ' when ''staffSchool'' then cid := null;';
  anchor_run text := ' when ''pointAdjustment'' then entity := private.ops_point_adjustment(conf, cid, actor, new_id, command);';
begin
  definition := pg_get_functiondef('private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
  if (length(definition) - length(replace(definition, anchor_cid, ''))) <> length(anchor_cid) then raise exception 'Operations dispatcher (committee anchor) changed; review hold patch'; end if;
  if (length(definition) - length(replace(definition, anchor_run, ''))) <> length(anchor_run) then raise exception 'Operations dispatcher (handler anchor) changed; review hold patch'; end if;
  definition := replace(definition, anchor_cid, anchor_cid || chr(10) ||
' when ''closeDay'', ''holdSettings'', ''heldDecide'', ''heldBulkApprove'' then
   if not private.has_access(conf, null, array[''admin'']::public.conference_role[]) then raise exception ''Executive access required'' using errcode=''42501''; end if;
   cid := null;');
  definition := replace(definition, anchor_run, anchor_run || chr(10) ||
' when ''closeDay'' then affected := private.ops_close_day(conf, actor, new_id, command); entity := new_id;
 when ''holdSettings'' then affected := private.ops_hold_settings(conf, command);
 when ''heldDecide'' then affected := private.ops_held_decide(conf, actor, command); entity := private.uuid_or_null(command->>''heldId'');
 when ''heldBulkApprove'' then affected := private.ops_held_bulk_approve(conf, actor, command);');
  execute definition;
end $patch$;

-- ---- Read model: held actions travel with the operations snapshot (RLS applies: Executive and the committee's Chair) ----------
do $patch$
declare
  definition text;
  anchor constant text := '''documentDecisions'', private.decision_history(conf)';
begin
  definition := pg_get_functiondef('public.operations_snapshot(uuid)'::regprocedure);
  if (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then raise exception 'operations_snapshot anchor changed; review hold patch'; end if;
  execute replace(definition, anchor, anchor || ',
  ''heldActions'', (select coalesce(jsonb_agg(jsonb_build_object(''id'',h.id,''committeeId'',h.committee_id,''deviceId'',h.device_id,''deviceSeq'',h.device_seq,''actorId'',h.actor_id,
      ''role'',h.requested_role,''command'',h.command,''reason'',h.reason,''state'',h.state,''timeConfidence'',h.time_confidence,''receivedAt'',h.received_at,''clientTime'',h.client_time,
      ''decidedBy'',h.decided_by,''decidedAt'',h.decided_at,''decisionReason'',h.decision_reason,''lastError'',h.last_error) order by h.received_at, h.id),''[]''::jsonb)
    from public.held_action h where h.conference_id = conf and (h.state = ''held'' or h.decided_at > now() - interval ''2 days'')),
  ''dayCloses'', (select coalesce(jsonb_agg(jsonb_build_object(''day'',c.conference_day,''closedAt'',c.closed_at,''reason'',c.reason) order by c.conference_day),''[]''::jsonb)
    from public.conference_day_close c where c.conference_id = conf)');
end $patch$;

revoke all on function private.reject_published_session_delete(), private.command_class(text), private.payload_hash(jsonb, public.conference_role, text, timestamptz),
  private.held_replay(uuid, uuid, jsonb, public.conference_role, text, timestamptz), private.hold_gate(uuid, uuid, uuid, jsonb, public.conference_role, text, timestamptz),
  private.run_held(public.held_action, bigint), private.ops_held_decide(uuid, uuid, jsonb), private.ops_held_bulk_approve(uuid, uuid, jsonb),
  private.ops_close_day(uuid, uuid, uuid, jsonb), private.ops_hold_settings(uuid, jsonb) from public, anon, authenticated, service_role;
