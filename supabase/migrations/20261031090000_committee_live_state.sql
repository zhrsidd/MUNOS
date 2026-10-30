-- Session model: live state keyed by committee, roll calls, ballot snapshots, timer removal (docs/SESSION_MODEL.md sections 6, 8 and 12.7).
-- PROTECTED change (schema, every Chair write path, snapshots, public submission functions; unapplied; needs independent review).
--
-- Owner decision (31 Oct 2026): full rekey. The speaker queue, debate mode, the floor (speeches), votes and attendance stop being keyed by a
-- session the Chair chose. New rows carry "sessionId" NULL and are keyed by committee (votes by resolution and delegate); the session a
-- record belongs to is the server's label (record_label, 20261030090000). Rows written before this migration keep their sessionId and are
-- history: the live views below read only committee-keyed rows. Chairs no longer choose a session: the currentSession command is refused.
--
--   * Commands name their committee (committeeId). A command saved by an older build that names a session is still accepted; the session only
--     identifies the committee. Attendance and timer commands are retired with a clear error (a saved one is retained for review, never lost).
--   * Presence comes from committed roll calls (section 6): the live roll call is the committed revision with the greatest effective time
--     (device commit time when Trusted, otherwise server receipt). A dependent action is checked against the roll call effective at the
--     action's time, or against the roll call it cites ({rollCall: {id, revision}}) unless a later Trusted revision supersedes it by then.
--   * A ballot snapshots the eligible set when it opens (voteMode). Every vote is checked against that snapshot; the counted close and the
--     veto use it. The abstention rule is unchanged (owner, 31 Oct): Present & Voting cannot abstain, Present can, Absent cannot vote.
--   * Roll calls are committed whole by the device (rollCallCommit, one idempotent mutation with the full row set); drafts stay on the device.
--     Owner decision (31 Oct): a roll call in a break is labelled with the previous session, as the window rule gives.
--   * Timers are local only: the timer table is no longer written or sent (dropping it is left to the schema owner).
--
-- The rewritten functions at the end are GENERATED from the definitions in force after 20261030110000, with exact-text edits, so every
-- earlier patch (lifecycle lock, labelling context, hold gate, held replay) is preserved.

-- ---- Schema --------------------------------------------------------------------------------------------------------------
alter table public.speaker_queue alter column "sessionId" drop not null;
alter table public.speeches alter column "sessionId" drop not null;
alter table public.votes alter column "sessionId" drop not null;
alter table public.participation_events alter column "sessionId" drop not null;
alter table public.participation_adjustments alter column "sessionId" drop not null;
alter table public.amendments alter column "sessionId" drop not null;
alter table public.debate_states drop constraint debate_states_pkey;
alter table public.debate_states alter column "sessionId" drop not null;
alter table public.debate_states add column id uuid not null default gen_random_uuid() primary key;

create unique index debate_states_committee on public.debate_states(committee_id) where "sessionId" is null;
create unique index queue_active_committee on public.speaker_queue(committee_id, lane, "delegateId") where state = 'active' and "sessionId" is null;
create index queue_committee_order on public.speaker_queue(committee_id, lane, position) where state = 'active' and "sessionId" is null;
create unique index speech_one_floor_committee on public.speeches(committee_id) where state <> 'finished' and "sessionId" is null;
create unique index votes_resolution_delegate on public.votes("resolutionId", "delegateId") where "sessionId" is null;

alter table public.roll_call add column effective_at timestamptz;
alter table public.roll_call add constraint roll_call_committed_effective check (state <> 'committed' or effective_at is not null or legacy);
create index roll_call_live on public.roll_call(committee_id, effective_at desc, id desc, revision desc) where state = 'committed';

create table public.ballot_eligibility (
  resolution_id uuid not null,
  delegate_id uuid not null,
  conference_id uuid not null references public.conferences(id),
  committee_id uuid not null,
  status text not null check (status in ('Present', 'Present & Voting', 'Absent')),
  roll_call_id uuid,
  roll_call_revision integer,
  opened_at timestamptz not null default now(),
  primary key (resolution_id, delegate_id),
  foreign key (resolution_id, conference_id, committee_id) references public.documents(id, conference_id, committee_id),
  foreign key (delegate_id, conference_id, committee_id) references public.delegates(id, conference_id, committee_id)
);
alter table public.ballot_eligibility enable row level security;
revoke all on public.ballot_eligibility from public, anon, authenticated, service_role;
grant select on public.ballot_eligibility to authenticated;
-- The same boundary as attendance and roll calls: Executive, Chair, observer.
create policy read_authorized on public.ballot_eligibility for select to authenticated
  using (private.has_access(conference_id, committee_id, array['admin', 'chair', 'observer']::public.conference_role[]));

-- ---- Presence, eligibility and ballots ---------------------------------------------------------------------------------------
-- A roll call is timed by ITS OWN commit time (docs/SESSION_MODEL.md section 6), not by the action that carries it: admission (the hold
-- gate), the session label and the effective time must all use the same instant. Every other command keeps the action's time.
create function private.command_device_time(command jsonb, fallback timestamptz) returns timestamptz
language plpgsql stable set search_path='' as $$
begin
  if command->>'type' = 'rollCallCommit' then
    begin
      return coalesce(private.session_ts(command->>'committedAt'), fallback);
    exception when others then
      return null; -- an unreadable commit time is Uncertain (held with enforcement on), never the outer action time
    end;
  end if;
  return fallback;
end $$;

-- Same body as 20261030090000, except the device time a roll call is labelled by is its own commit time.
create or replace function private.set_mutation_context(conf uuid, mutation uuid, client_time timestamptz, command jsonb) returns void
language plpgsql set search_path='' as $$
declare
  dev jsonb := case when jsonb_typeof(command->'_device') = 'object' then command->'_device' else '{}'::jsonb end;
  approving boolean := coalesce(current_setting('munos.approving', true), '') = mutation::text;
  held public.held_action;
begin
  if approving then select * into held from public.held_action where id = mutation; end if;
  perform set_config('munos.mutation_ctx', jsonb_build_object(
    'conference', conf, 'mutation', mutation,
    'receivedAt', private.session_iso(coalesce(held.received_at, date_trunc('milliseconds', clock_timestamp()))),
    'heldActionId', held.id,
    'confirmedOffsetMs', case when held.id is not null then nullif(current_setting('munos.approval_offset', true), '')::bigint end,
    'clientTime', private.session_iso(private.command_device_time(command, client_time)),
    'deviceId', private.uuid_or_null(dev->>'deviceId'),
    'deviceSeq', case when dev->>'deviceSeq' ~ '^[0-9]{1,15}$' then (dev->>'deviceSeq')::bigint end,
    'displayedLabel', private.uuid_or_null(dev->>'displayedLabel'),
    'displayedReported', (dev ? 'displayedLabel') and (jsonb_typeof(dev->'displayedLabel') = 'null' or private.uuid_or_null(dev->>'displayedLabel') is not null))::text, true);
end $$;

-- A held command waits for what it depends on (section 5): a Control for an earlier held Control or roll call from the same device and committee,
-- anything citing a held roll call, a roll call revision or copy for the roll call it builds on, a vote for its resolution's held ballot restart, and a speech or POI score for the held command that creates its speech or POI entry. Without this a queue action that cites a held roll call reaches private.eligible, fails because
-- the cited revision was never applied, and becomes a permanent client conflict that blocks the rest of the outbox.
create function private.waits_for_held(p_committee uuid, p_device uuid, p_seq bigint, p_command jsonb) returns boolean
language sql stable set search_path='' as $$
  select exists (
    select 1 from public.held_action e
     where e.state = 'held' and e.committee_id = p_committee
       and (
         -- Same device, earlier: a Control waits for any earlier held Control or roll call; a roll call waits for an earlier held roll call.
         (p_device is not null and p_seq is not null and e.device_id = p_device and e.device_seq < p_seq and (
              (private.command_class(p_command->>'type') = 'control' and private.command_class(e.command->>'type') in ('control', 'rollcall'))
           or (private.command_class(p_command->>'type') = 'rollcall' and private.command_class(e.command->>'type') = 'rollcall')))
         -- Whatever cites a held roll call waits for it (from any device).
         or (e.command->>'type' = 'rollCallCommit' and e.command->>'rollCallId' = p_command#>>'{rollCall,id}')
         -- A roll call revision waits for the held earlier revision of the same roll call, and a copy for the roll call it copies.
         or (p_command->>'type' = 'rollCallCommit' and e.command->>'type' = 'rollCallCommit' and (
              (e.command->>'rollCallId' = p_command->>'rollCallId' and (e.command->>'revision')::int < (p_command->>'revision')::int)
           or e.command->>'rollCallId' = p_command->>'copiedFrom'))
         -- A vote waits for the held ballot-opening command (voteMode) of its resolution: approving that restart later clears the ballot's votes.
         or (p_command->>'type' = 'vote' and e.command->>'type' = 'voteMode' and e.command->>'resolutionId' = p_command->>'resolutionId')
         -- Anything on a speech waits for an earlier held command on the same speech from the same device (its revision and state depend on it);
         -- a POI score also waits for the held recognition of its entry from any device.
         or (p_command->>'speechId' is not null and p_device is not null and p_seq is not null and e.device_id = p_device and e.device_seq < p_seq
             and e.command->>'speechId' = p_command->>'speechId')
         or (p_command->>'type' = 'poiScore' and e.command->>'type' = 'poiRecognize' and e.command->>'entryId' = p_command->>'entryId')
         -- Repeated corrections of one event, and repeated votes of one delegate on one resolution, carry optimistically incremented revisions:
         -- keep that device's order (an earlier held one must be decided first).
         or (p_device is not null and p_seq is not null and e.device_id = p_device and e.device_seq < p_seq and e.command->>'type' = p_command->>'type' and (
              (p_command->>'type' = 'event' and e.command->>'id' = p_command->>'id')
           or (p_command->>'type' = 'vote' and e.command->>'resolutionId' = p_command->>'resolutionId' and e.command->>'delegateId' = p_command->>'delegateId')))
         -- A counted close must include unresolved vote changes for its ballot, even from another device.
         or (p_command->>'type' = 'document' and p_command->>'status' = 'Closed'
             and coalesce(p_command->>'method', '') <> 'observed' and coalesce(p_command->>'outcome', '') <> 'Withdrawn'
             and e.command->>'type' = 'vote' and e.command->>'resolutionId' = p_command->>'id')
         -- A correction of an event waits for the held command that creates that event (ids derive from the creating command's key).
         or (p_command->>'type' = 'event' and (substr(e.id::text, 1, 24) || '000000000001' = p_command->>'id' or substr(e.id::text, 1, 24) || '000000000002' = p_command->>'id'))
         -- Whatever names a record by id waits for the held command that creates it, from any device (the id derives from that command's key):
         -- a speech by speechStart or speechYield, a queue entry by queueAdd or queue, a POI entry by poiAdd, a deduction by pointAdjustment.
         or (p_command->>'speechId' = substr(e.id::text, 1, 24) || '000000000001' and e.command->>'type' in ('speechStart', 'speechYield'))
         or (p_command->>'entryId' = substr(e.id::text, 1, 24) || '000000000001' and (
              (p_command->>'type' in ('queueRemove', 'speechStart') and e.command->>'type' in ('queueAdd', 'queue'))
           or (p_command->>'type' in ('poiRecognize', 'poiScore', 'poiRemove') and e.command->>'type' = 'poiAdd')))
         or (jsonb_typeof(p_command->'ids') = 'array' and p_command->>'type' in ('queueOrder', 'poiOrder') and e.command->>'type' in ('queueAdd', 'queue', 'poiAdd')
             and (substr(e.id::text, 1, 24) || '000000000001') in (select jsonb_array_elements_text(p_command->'ids')))
         or (p_command->>'type' = 'pointAdjustment' and e.command->>'type' = 'pointAdjustment' and p_command->>'adjustmentId' = substr(e.id::text, 1, 24) || '000000000001'))
  )
$$;

-- The committee of the held command that will create the event with this id (ids derive from the creating command's key), else null.
create function private.held_event_committee(conf uuid, event_id text) returns uuid
language sql stable set search_path='' as $$
  select h.committee_id from public.held_action h
   where h.conference_id = conf and h.state = 'held'
     and (substr(h.id::text, 1, 24) || '000000000001' = event_id or substr(h.id::text, 1, 24) || '000000000002' = event_id)
   limit 1
$$;

-- Same bodies as 20261030100000, except that the ordering rule uses private.waits_for_held (Controls wait for held roll calls too).
create or replace function private.ops_held_decide(conf uuid, actor uuid, command jsonb) returns uuid[]
language plpgsql set search_path='' as $$
declare
  h public.held_action;
  decision text := command->>'decision';
  why text := btrim(command->>'reason');
  hid uuid := private.uuid_or_null(command->>'heldId');
begin
  if decision is null or decision not in ('approve', 'discard') then raise exception 'decision must be approve or discard' using errcode = '22023'; end if;
  if why is null or length(why) not between 1 and 500 then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into h from public.held_action where id = hid and conference_id = conf for update;
  if not found then raise exception 'Held action unavailable' using errcode = '22023'; end if;
  if h.state <> 'held' then raise exception 'This action has already been decided' using errcode = '22023'; end if;
  -- A Control cannot overtake an earlier held Control or roll call from the same device and committee, nor the held roll call it cites:
  -- decide that one first. Records are independent.
  if decision = 'approve' and private.command_class(h.command->>'type') is not null and private.waits_for_held(h.committee_id, h.device_id, h.device_seq, h.command) then
    raise exception 'Decide the earlier held action from this device first' using errcode = '22023';
  end if;
  if decision = 'approve' and private.run_held(h, null) is not null then return array[h.committee_id]; end if;
  update public.held_action set state = case decision when 'approve' then 'applied' else 'discarded' end, decided_by = actor, decided_at = now(), decision_reason = why where id = h.id;
  return array[h.committee_id];
end $$;

create or replace function private.ops_held_bulk_approve(conf uuid, actor uuid, command jsonb) returns uuid[]
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
    -- A Control never overtakes an earlier UNRESOLVED Control or roll call from this device and committee (whatever it was held for, including
    -- reasons this batch does not approve, and a failure earlier in this batch or a previous attempt), nor the held roll call it cites.
    continue when private.command_class(h.command->>'type') is not null and private.waits_for_held(h.committee_id, h.device_id, h.device_seq, h.command);
    if private.run_held(h, off) is null then
      update public.held_action set state = 'applied', decided_by = actor, decided_at = now(), decision_reason = why where id = h.id;
    end if;
    if not h.committee_id = any(affected) then affected := affected || h.committee_id; end if;
  end loop;
  return affected;
end $$;

create function private.require_operational_committee(conf uuid, cid uuid) returns void
language plpgsql set search_path='' as $$
begin
  if cid is not null and exists (select 1 from public.committees where id = cid and conference_id = conf and archived) then
    raise exception 'This committee is archived. Saved changes need review.' using errcode = 'PT409';
  end if;
end $$;

-- The action's time as the server trusts it (section 4): the device time when Trusted (corrected by a confirmed clock error when an
-- Executive approves a held action), otherwise the server receipt time. Read from the dispatcher's per-transaction context.
create function private.action_time(conf uuid) returns timestamptz
language plpgsql stable set search_path='' as $$
declare
  ctx jsonb := nullif(current_setting('munos.mutation_ctx', true), '')::jsonb;
  received timestamptz; client timestamptz;
begin
  if ctx is null then return date_trunc('milliseconds', clock_timestamp()); end if;
  received := private.session_ts(ctx->>'receivedAt');
  client := private.session_ts(ctx->>'clientTime');
  if (ctx->>'confirmedOffsetMs') is not null and client is not null then return client - (ctx->>'confirmedOffsetMs')::bigint * interval '1 millisecond'; end if;
  return case when private.time_confidence(conf, private.uuid_or_null(ctx->>'deviceId'), client, received) = 'trusted' then client else received end;
end $$;

-- A delegate's status in the committed roll call effective at `at` (null `at`: the live one). Null when the committee has no roll call.
create function private.presence_at(cid uuid, did uuid, at timestamptz) returns text
language sql stable set search_path='' as $$
  select coalesce((select x.status from public.roll_call_row x where x.roll_call_id = l.id and x.revision = l.revision and x.delegate_id = did), 'Absent')
    from (select r.id, r.revision from public.roll_call r
           where r.committee_id = cid and r.state = 'committed' and r.effective_at is not null and (at is null or r.effective_at <= at)
           order by r.effective_at desc, r.id desc, r.revision desc limit 1) l
$$;

-- Historical eligibility (section 6) for an action that depends on presence.
create function private.eligible(conf uuid, cid uuid, did uuid, command jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare
  at timestamptz := private.action_time(conf);
  cited uuid := private.uuid_or_null(command#>>'{rollCall,id}');
  cited_rev integer := case when command#>>'{rollCall,revision}' ~ '^[0-9]{1,6}$' then (command#>>'{rollCall,revision}')::integer end;
  rc public.roll_call;
  st text;
begin
  if cited is not null then
    select * into rc from public.roll_call where id = cited and revision = cited_rev and committee_id = cid and conference_id = conf and state = 'committed';
    if not found then return false; end if;
    -- A later Trusted revision effective at or before the action supersedes the one the device relied on.
    if not exists (select 1 from public.roll_call r where r.committee_id = cid and r.state = 'committed' and r.time_confidence = 'trusted'
                     and (r.effective_at, r.id, r.revision) > (rc.effective_at, rc.id, rc.revision) and r.effective_at <= at) then
      select status into st from public.roll_call_row where roll_call_id = rc.id and revision = rc.revision and delegate_id = did;
      return coalesce(st, 'Absent') <> 'Absent';
    end if;
  end if;
  return coalesce(private.presence_at(cid, did, at), 'Absent') <> 'Absent';
end $$;

-- Opening (or restarting) a ballot snapshots every delegate's status in the roll call effective at that moment.
create function private.open_ballot(conf uuid, cid uuid, rid uuid) returns void
language plpgsql set search_path='' as $$
declare at timestamptz := private.action_time(conf); l record;
begin
  select r.id, r.revision into l from public.roll_call r
   where r.committee_id = cid and r.state = 'committed' and r.effective_at is not null and r.effective_at <= at
   order by r.effective_at desc, r.id desc, r.revision desc limit 1;
  delete from public.ballot_eligibility where resolution_id = rid;
  insert into public.ballot_eligibility(resolution_id, delegate_id, conference_id, committee_id, status, roll_call_id, roll_call_revision)
  select rid, d.id, conf, cid, coalesce(x.status, 'Absent'), l.id, l.revision
    from public.delegates d
    left join public.roll_call_row x on x.roll_call_id = l.id and x.revision = l.revision and x.delegate_id = d.id
   where d.committee_id = cid and d.conference_id = conf;
end $$;

-- rollCallCommit: {committeeId, rollCallId, revision, copiedFrom?, observedAt, committedAt, rows: [{delegateId, status}]}.
-- One idempotent mutation with the full row set; a delegate not in the rows is Absent. A correction is the next revision of the same id.
create function private.commit_roll_call(conf uuid, cid uuid, actor uuid, command jsonb) returns uuid
language plpgsql set search_path='' as $$
declare
  rc_id uuid := private.uuid_or_null(command->>'rollCallId');
  rev integer := case when command->>'revision' ~ '^[0-9]{1,6}$' then (command->>'revision')::integer end;
  observed timestamptz := private.session_ts(command->>'observedAt');
  committed timestamptz := private.session_ts(command->>'committedAt');
  copied uuid := private.uuid_or_null(command->>'copiedFrom');
  ctx jsonb := nullif(current_setting('munos.mutation_ctx', true), '')::jsonb;
  received timestamptz := coalesce(private.session_ts(ctx->>'receivedAt'), date_trunc('milliseconds', clock_timestamp()));
  confidence text; effective timestamptz;
begin
  if rc_id is null or rev is null or rev < 1 then raise exception 'A roll call needs an id and a revision' using errcode = '22023'; end if;
  if observed is null or committed is null or committed < observed then raise exception 'A roll call needs its observed and committed times' using errcode = '22023'; end if;
  if jsonb_typeof(command->'rows') is distinct from 'array' then raise exception 'A roll call carries its full row set' using errcode = '22023'; end if;
  if exists (select 1 from public.roll_call where id = rc_id and (committee_id <> cid or conference_id <> conf)) then raise exception 'Roll call unavailable' using errcode = '22023'; end if;
  if exists (select 1 from public.roll_call where id = rc_id and revision = rev) then raise exception 'This roll call revision is already committed' using errcode = '22023'; end if;
  if rev > 1 and not exists (select 1 from public.roll_call where id = rc_id and revision = rev - 1 and state = 'committed') then raise exception 'Commit the previous revision first' using errcode = '22023'; end if;
  if copied is not null and not exists (select 1 from public.roll_call where id = copied and committee_id = cid and state = 'committed') then raise exception 'Copied roll call unavailable' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(command->'rows') x
              where coalesce(x->>'status', '') not in ('Present', 'Present & Voting', 'Absent')
                 or not exists (select 1 from public.delegates d where d.id = private.uuid_or_null(x->>'delegateId') and d.committee_id = cid and d.conference_id = conf)) then
    raise exception 'Every row needs a delegate of this committee and a status' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(command->'rows')) <> (select count(distinct x->>'delegateId') from jsonb_array_elements(command->'rows') x) then
    raise exception 'Each delegate appears once in a roll call' using errcode = '22023';
  end if;
  confidence := private.time_confidence(conf, private.uuid_or_null(ctx->>'deviceId'), committed, received);
  effective := case when confidence = 'trusted' then committed else received end;
  if (ctx->>'confirmedOffsetMs') is not null then confidence := 'trusted'; effective := committed - (ctx->>'confirmedOffsetMs')::bigint * interval '1 millisecond'; end if;
  insert into public.roll_call(id, revision, conference_id, committee_id, state, copied_from, observed_at, local_committed_at, received_at, server_committed_at, time_confidence, effective_at, created_by)
  values (rc_id, rev, conf, cid, 'committed', copied, observed, committed, received, now(), confidence, effective, actor);
  insert into public.roll_call_row(roll_call_id, revision, conference_id, committee_id, delegate_id, status)
  select rc_id, rev, conf, cid, (x->>'delegateId')::uuid, x->>'status' from jsonb_array_elements(command->'rows') x;
  -- Only the live roll call changes the floor: absent delegates leave the speaker queue. A delayed older one never does.
  if not exists (select 1 from public.roll_call r where r.committee_id = cid and r.state = 'committed' and (r.effective_at, r.id, r.revision) > (effective, rc_id, rev)) then
    update public.speaker_queue q set state = 'removed', updated_at = now()
     where q.committee_id = cid and q."sessionId" is null and q.state = 'active'
       and coalesce((select x.status from public.roll_call_row x where x.roll_call_id = rc_id and x.revision = rev and x.delegate_id = q."delegateId"), 'Absent') = 'Absent';
  end if;
  return rc_id;
end $$;

-- Roll calls are labelled like every other record (the session whose window holds their effective time; a break gives the previous one).
create trigger label_record after insert on public.roll_call for each row execute function private.label_record();

-- ---- Rewritten functions (generated from the definitions in force after 20261030110000; see the header) ----

CREATE OR REPLACE FUNCTION private.apply_procedure(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=auth.uid(); kind text:=command->>'type'; cid uuid; sid uuid:=private.uuid_or_null(command->>'sessionId');
 did uuid:=private.uuid_or_null(command->>'delegateId'); rid uuid:=private.uuid_or_null(command->>'resolutionId');
 sp public.speeches; r public.documents; prior private.mutation_receipts; actual text; ids uuid[]; entry uuid;
 new_id uuid:=(substr(mutation::text,1,24)||'000000000001')::uuid;
 second_id uuid:=(substr(mutation::text,1,24)||'000000000002')::uuid;
 payload jsonb:=jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
 lane_value text:=command->>'lane'; classification_value text:=command->>'classification'; n integer; points_value integer:=(command->>'points')::integer;
 vals integer[]; amend_value uuid; queue_row public.speaker_queue; poi_row public.poi_queue; lane_active text;
begin
 perform private.lock_lifecycle();
 perform private.set_mutation_context(conf, mutation, client_time, command);
 if actor is null then raise exception 'Session required' using errcode='42501'; end if;
 if pg_column_size(command)>262144 then raise exception 'Command too large' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 if private.held_replay(conf, mutation, command, requested_role, expected, client_time) then return; end if;
 select * into prior from private.mutation_receipts where id=mutation;
 if found then
  if prior.actor_id<>actor or prior.conference_id<>conf or prior.payload<>payload then raise exception 'Idempotency key reused for a different action' using errcode='22023'; end if;
  return;
 end if;
 -- Live state is keyed by committee (docs/SESSION_MODEL.md section 8). A command names its committee; one saved by an older build names a
 -- session, which now only identifies the committee. Chairs no longer choose sessions: the schedule labels records.
 if kind='currentSession' then raise exception 'Sessions follow the published schedule; Chairs no longer choose them' using errcode='22023'; end if;
 cid:=coalesce(private.uuid_or_null(command->>'committeeId'),(select committee_id from public.sessions where id=sid and conference_id=conf));
 if cid is null or not exists(select 1 from public.committees where id=cid and conference_id=conf) then raise exception 'Committee unavailable' using errcode='42501'; end if;
 if requested_role<>(case when kind='vetoRules' then 'admin'::public.conference_role else 'chair'::public.conference_role end) or not private.has_access(conf,cid,array[requested_role]) then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from public.committees where id=cid for update;
 if private.hold_gate(conf, cid, mutation, command, requested_role, expected, client_time) then return; end if;
 perform private.require_operational_committee(conf,cid);
 if did is not null and not private.eligible(conf,cid,did,command) then raise exception 'Delegate must be present' using errcode='22023'; end if;
 if command ? 'speechId' then
  select * into sp from public.speeches where id=private.uuid_or_null(command->>'speechId') and committee_id=cid and conference_id=conf;
  if not found or sp.state='finished' then raise exception 'Speech has finished or is unavailable' using errcode='22023'; end if;
 end if;
 if kind='debateMode' then select coalesce((select revision from public.debate_states where committee_id=cid and "sessionId" is null),0)::text into actual;
 elsif kind='queueOrder' then select coalesce(string_agg(id::text,',' order by position),'') into actual from public.speaker_queue where committee_id=cid and "sessionId" is null and lane=lane_value and state='active';
 elsif kind='poiOrder' then select coalesce(string_agg(id::text,',' order by position),'') into actual from public.poi_queue where "speechId"=sp.id;
 elsif kind='speechStart' then select coalesce((select id::text from public.speeches where committee_id=cid and "sessionId" is null and state<>'finished'),'empty') into actual;
 elsif kind in ('speechYield','speechFinish','poiAllowance','poiRecognize','poiScore','poiRemove') then actual:=sp.revision::text;
 elsif kind='voteMode' then select revision::text into actual from public.documents where id=rid and committee_id=cid and conference_id=conf;
 end if;
 if actual is not null and actual is distinct from expected then raise sqlstate 'PT409' using message='Another Chair changed this item. Review before applying.'; end if;
 case kind
 when 'vetoRules' then
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(command->'delegateIds');
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.delegates d where d.id=x and d.committee_id=cid)) or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception 'Invalid veto delegations' using errcode='22023'; end if;
  update public.committees set "vetoEnabled"=(command->>'enabled')::boolean,"vetoDelegateIds"=ids where id=cid;
 when 'debateMode' then
  insert into public.debate_states("sessionId",conference_id,committee_id,mode,phase) values(null,conf,cid,command->>'mode',command->>'phase')
  on conflict(committee_id) where "sessionId" is null do update set mode=excluded.mode,phase=excluded.phase,revision=debate_states.revision+1;
 when 'queueAdd' then
  select coalesce(max(position),-1)+1 into n from public.speaker_queue where committee_id=cid and "sessionId" is null and lane=lane_value and state='active';
  insert into public.speaker_queue(id,conference_id,committee_id,"sessionId","delegateId",lane,position) values(new_id,conf,cid,null,did,lane_value,n) on conflict do nothing;
 when 'queueRemove' then update public.speaker_queue set state='removed' where id=private.uuid_or_null(command->>'entryId') and committee_id=cid;
 when 'queueOrder' then
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(command->'ids');
  if cardinality(ids)<>(select count(*) from public.speaker_queue where committee_id=cid and "sessionId" is null and lane=lane_value and state='active') or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or exists(select 1 from unnest(ids)x where not exists(select 1 from public.speaker_queue q where q.id=x and q.committee_id=cid and q."sessionId" is null and q.lane=lane_value and q.state='active')) then raise sqlstate 'PT409' using message='Queue changed'; end if;
  update public.speaker_queue set position=array_position(ids,id)-1 where id=any(ids);
 when 'speechStart' then
  if exists(select 1 from public.speeches where committee_id=cid and "sessionId" is null and state<>'finished') then raise exception 'Return the floor to Chair first' using errcode='22023'; end if;
  if rid is not null then
   select * into r from public.documents where id=rid and committee_id=cid and conference_id=conf and status='In Debate';
   if not found then raise exception 'Resolution must be in debate' using errcode='22023'; end if;
  end if;
  if classification_value='Co-Submitter' or (classification_value='Main Submitter' and (rid is null or r."submitterId" is distinct from did)) then raise exception 'Invalid speech relationship' using errcode='22023'; end if;
  -- A speech during an amendment debate keeps the amendment context (the parent resolution stays In Debate).
  if rid is not null then select id into amend_value from public.amendments where committee_id=cid and conference_id=conf and status='In Debate' and "resolutionId"=rid; end if;
  if command ? 'amendmentId' and private.uuid_or_null(command->>'amendmentId') is distinct from amend_value then raise sqlstate 'PT409' using message='The amendment debate changed. Review the Debate Console.'; end if;
  if amend_value is not null and classification_value='Main Submitter' then raise exception 'Main Submitter and Co-Submitter speeches belong to resolution debate, not amendment debate.' using errcode='22023'; end if;
  if command ? 'entryId' then
   select * into queue_row from public.speaker_queue where id=private.uuid_or_null(command->>'entryId') and committee_id=cid and "sessionId" is null and "delegateId"=did and state='active';
   if not found then raise sqlstate 'PT409' using message='Queue entry changed'; end if;
   -- Only the first speaker of the active lane (open debate, or the current For/Against phase) is recognized.
   select case when coalesce(ds.mode,'open')='open' then 'open' else ds.phase end into lane_active from (select 1) one left join public.debate_states ds on ds.committee_id=cid and ds."sessionId" is null;
   if queue_row.lane is distinct from lane_active or exists(select 1 from public.speaker_queue o where o.committee_id=cid and o."sessionId" is null and o.lane=queue_row.lane and o.state='active' and o.position<queue_row.position) then raise sqlstate 'PT409' using message='The speaker queue changed. Only the first speaker in the current queue can be recognized.'; end if;
   update public.speaker_queue set state='completed' where id=queue_row.id;
  end if;
  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"createdAt","amendmentId") values(new_id,conf,cid,null,did,rid,classification_value,client_time,amend_value);
 when 'speechYield' then
  if sp.classification<>'Main Submitter' or sp."resolutionId" is null or did=sp."delegateId" then raise exception 'Only Main Submitter may yield to another delegate' using errcode='22023'; end if;
  if sp."amendmentId" is not null then raise exception 'Main Submitter and Co-Submitter speeches belong to resolution debate, not amendment debate.' using errcode='22023'; end if;
  update public.speeches set state='finished',revision=revision+1 where id=sp.id;
  delete from public.poi_queue where "speechId"=sp.id;
  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"yieldedFrom","createdAt","amendmentId") values(new_id,conf,cid,null,did,sp."resolutionId",'Co-Submitter',sp.id,client_time,sp."amendmentId");
 when 'speechScore' then
  vals:=private.scoring_values(conf,cid,'speech');
  if points_value is null or not points_value=any(vals) then raise exception 'Choose a configured speech value' using errcode='22023'; end if;
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,sp."delegateId",null,sp."resolutionId",'speech',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
  if sp.classification='Main Submitter' and not exists(select 1 from public.participation_events where "resolutionId"=sp."resolutionId" and "categoryId"='submitter') then
   vals:=private.scoring_values(conf,cid,'submitter');
   if coalesce(command->'submitterPoints','5'::jsonb) is distinct from to_jsonb(vals[1]) then raise sqlstate 'PT409' using message='The Main Submitter points changed. Review the Debate Console.'; end if;
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification) values(second_id,conf,cid,sp."delegateId",null,sp."resolutionId",'submitter',vals[1],actor,client_time,sp.id,sp.classification);
  end if;
 when 'speechFinish' then
  update public.speeches set state='finished',revision=revision+1 where id=sp.id;
  delete from public.poi_queue where "speechId"=sp.id;
 when 'poiAllowance' then
  n:=(command->>'limit')::integer;
  if n is not null and (n<sp."poiCount" or n<0 or n>1000) then raise exception 'Invalid POI allowance' using errcode='22023'; end if;
  update public.speeches set "poiLimit"=n,state='pois',revision=revision+1 where id=sp.id;
 when 'poiAdd' then
  if did=sp."delegateId" then raise exception 'Speaker cannot ask own POI' using errcode='22023'; end if;
  select coalesce(max(position),-1)+1 into n from public.poi_queue where "speechId"=sp.id;
  insert into public.poi_queue(id,conference_id,committee_id,"speechId","delegateId",position) values(new_id,conf,cid,sp.id,did,n) on conflict do nothing;
 when 'poiOrder' then
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(command->'ids');
  if cardinality(ids)<>(select count(*) from public.poi_queue where "speechId"=sp.id) or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or exists(select 1 from unnest(ids)x where not exists(select 1 from public.poi_queue p where p.id=x and p."speechId"=sp.id)) then raise sqlstate 'PT409' using message='POI queue changed'; end if;
  update public.poi_queue set position=array_position(ids,id)-1 where id=any(ids);
 when 'poiRecognize' then
  if sp.state<>'pois' or (sp."poiLimit" is not null and sp."poiCount">=sp."poiLimit") then raise exception 'Set or extend POIs first' using errcode='22023'; end if;
  if exists(select 1 from public.poi_queue where "speechId"=sp.id and "recognizedAt" is not null) then raise exception 'Score or withdraw the current POI first' using errcode='22023'; end if;
  if command ? 'points' then
   -- Legacy one-step recognition saved by an older client: recognize and score together, exactly once.
   vals:=private.scoring_values(conf,cid,'poi');
   if points_value is null or not points_value=any(vals) then raise exception 'Choose a configured POI value' using errcode='22023'; end if;
   delete from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id returning "delegateId" into did;
   if did is null or not private.eligible(conf,cid,did,command) then raise exception 'POI delegate is unavailable' using errcode='22023'; end if;
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,did,null,sp."resolutionId",'poi',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
   update public.speeches set "poiCount"="poiCount"+1,revision=revision+1 where id=sp.id;
  else
   -- Recognition only gives the floor to the first raised placard. It records no participation points.
   select * into poi_row from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id;
   if not found or exists(select 1 from public.poi_queue o where o."speechId"=sp.id and o.position<poi_row.position) then raise sqlstate 'PT409' using message='The POI queue changed. Only the first POI can be recognized.'; end if;
   if not private.eligible(conf,cid,poi_row."delegateId",command) then raise exception 'POI delegate is unavailable' using errcode='22023'; end if;
   update public.poi_queue set "recognizedAt"=client_time where id=poi_row.id;
   update public.speeches set revision=revision+1 where id=sp.id;
  end if;
 when 'poiScore' then
  select * into poi_row from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id;
  if not found or poi_row."recognizedAt" is null then raise exception 'Recognize this POI before scoring it' using errcode='22023'; end if;
  vals:=private.scoring_values(conf,cid,'poi');
  if points_value is null or not points_value=any(vals) then raise exception 'Choose a configured POI value' using errcode='22023'; end if;
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,poi_row."delegateId",null,sp."resolutionId",'poi',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
  delete from public.poi_queue where id=poi_row.id;
  update public.speeches set "poiCount"="poiCount"+1,revision=revision+1 where id=sp.id;
 when 'poiRemove' then
  delete from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id;
  if not found then raise sqlstate 'PT409' using message='POI queue changed'; end if;
  update public.speeches set revision=revision+1 where id=sp.id;
 when 'voteMode' then
  if not exists(select 1 from public.documents where id=rid and committee_id=cid and status='In Debate') then raise exception 'Open a resolution for debate first' using errcode='22023'; end if;
  delete from public.votes where "resolutionId"=rid; -- Prior ballot choices remain in the immutable audit log.
  update public.documents set "voteMode"=command->>'mode',"voteType"=command->>'voteType',revision=revision+1 where id=rid;
  -- The ballot's eligible set: every delegate's status in the roll call live at this moment (section 6). Every vote is checked against it.
  perform private.open_ballot(conf,cid,rid);
 else raise exception 'Unknown procedural command' using errcode='22023';
 end case;
 if kind not in ('queueAdd','queueOrder','queueRemove','poiAdd','poiOrder','poiAllowance','debateMode') then
  insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values(conf,cid,actor,kind,coalesce(sp.id,rid,did,cid),mutation,command);
 end if;
 insert into private.mutation_receipts(id,conference_id,actor_id,payload) values(mutation,conf,actor,payload);
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,'chair',mutation);
end $function$;

CREATE OR REPLACE FUNCTION private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=auth.uid(); kind text:=command->>'type'; cid uuid; sid uuid; did uuid;
 rid uuid; entity uuid; rec public.documents; ev public.participation_events;
 prior private.mutation_receipts; actual text; vals integer[]; target text:=command->>'status';
 new_id uuid:=(substr(mutation::text,1,24)||'000000000001')::uuid;
 second_id uuid:=(substr(mutation::text,1,24)||'000000000002')::uuid;
 payload jsonb:=jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
 n integer; yes_votes integer; no_votes integer; rule text; result public.document_outcome;
 row_data jsonb; category text; topic text:='chair'; label_value text; problem text; elig text; roll public.roll_call;
begin
 perform private.lock_lifecycle();
 perform private.set_mutation_context(conf, mutation, client_time, command);
 if actor is null then raise exception 'Session required' using errcode='42501'; end if;
 if pg_column_size(command)>1048576 then raise exception 'Command too large' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 if private.held_replay(conf, mutation, command, requested_role, expected, client_time) then return; end if;
 select * into prior from private.mutation_receipts where id=mutation;
 if found then
   if prior.actor_id<>actor or prior.conference_id<>conf or prior.payload<>payload then raise exception 'Idempotency key reused for a different action' using errcode='22023'; end if;
   return;
 end if;
 if kind in ('document','version') then
   rid:=(command->>'id')::uuid;
   select * into rec from public.documents where id=rid and conference_id=conf;
   if not found then raise exception 'Document unavailable' using errcode='42501'; end if;
   cid:=rec.committee_id; sid:=rec."sessionId";
 elsif kind='event' then
   select * into ev from public.participation_events where id=(command->>'id')::uuid and conference_id=conf;
   if not found then
     cid:=private.held_event_committee(conf, command->>'id');
     if cid is null then raise exception 'Event unavailable' using errcode='42501'; end if;
   else cid:=ev.committee_id; sid:=ev."sessionId"; end if;
 elsif command ? 'sessionId' then
   sid:=(command->>'sessionId')::uuid;
   select committee_id into cid from public.sessions where id=sid and conference_id=conf;
   if cid is null then raise exception 'Session unavailable' using errcode='42501'; end if;
 elsif kind in ('delegate','award') then
   did:=coalesce(command->>'delegateId',command->>'id')::uuid;
   select committee_id into cid from public.delegates where id=did and conference_id=conf;
 else cid:=nullif(command->>'committeeId','')::uuid;
 end if;
 if not private.has_access(conf,cid,array[requested_role]) then raise exception 'This session has no access to this role or committee' using errcode='42501'; end if;
 if kind in ('attendance','participation','event','queue','timer','vote','newDocument','version','award','rollCallCommit','currentSession') and requested_role<>'chair' then raise exception 'Chair access required' using errcode='42501'; end if;
 if kind not in ('attendance','participation','event','queue','timer','vote','newDocument','version','award','document','rollCallCommit','currentSession') and requested_role<>'admin' then raise exception 'Administrator access required' using errcode='42501'; end if;
 -- A committee's short transactions serialize queue, attendance and voting boundaries.
 -- Independent committees use different row locks; no conference-wide chair lock.
 if cid is not null then perform 1 from public.committees where id=cid and conference_id=conf for update;
 else perform 1 from public.conferences where id=conf for update; end if;
 if private.hold_gate(conf, cid, mutation, command, requested_role, expected, client_time) then return; end if;
 if kind='event' and ev.id is null then raise exception 'Event unavailable' using errcode='42501'; end if;
 -- An archived committee is history: no new Chair work (it replaces the per-session archive check; sessions are labels now).
 if kind in ('participation','queue','vote','newDocument','rollCallCommit') or (kind='document' and target='In Debate') then perform private.require_operational_committee(conf,cid); end if;
 if command ? 'delegateId' then
   did:=(command->>'delegateId')::uuid;
   if not exists(select 1 from public.delegates where id=did and conference_id=conf and committee_id=cid) then raise exception 'Delegate outside committee' using errcode='22023'; end if;
 end if;
 if command->>'resolutionId' is not null then
   rid:=(command->>'resolutionId')::uuid;
   if not exists(select 1 from public.documents where id=rid and conference_id=conf and committee_id=cid ) then raise exception 'Resolution outside committee' using errcode='22023'; end if;
 end if;
 if kind in ('document','version') then
   select * into rec from public.documents where id=rid;
   actual:=rec.revision::text;
 elsif kind='staffContact' then
   select "contactRevision"::text into actual from public.staff where id=(command->>'id')::uuid and conference_id=conf;
   if actual is null then raise exception 'Staff member unavailable' using errcode='42501'; end if;
 elsif kind='event' then select count(*)::text into actual from public.participation_corrections where event_id=ev.id;
 elsif kind='vote' then select coalesce((select revision from public.votes where "resolutionId"=rid and "delegateId"=did and "sessionId" is null),0)::text into actual;
 elsif kind='queue' and coalesce((command->>'advance')::boolean,false) then select coalesce((select id::text from public.speaker_queue where committee_id=cid and "sessionId" is null and state='active' order by position limit 1),'empty') into actual;
 end if;
 if actual is not null and actual is distinct from expected then raise sqlstate 'PT409' using message='Another chair updated this item. Review before applying your change.'; end if;
 case kind
 when 'attendance' then raise exception 'Attendance is taken with roll calls now' using errcode='22023';
 when 'participation' then
   category:=command->>'categoryId';
   if category='submitter' and (rid is null or (select "submitterId" from public.documents where id=rid) is distinct from did or exists(select 1 from public.participation_events where "resolutionId"=rid and "categoryId"='submitter')) then raise exception 'Main Submitter credit already recorded or resolution missing' using errcode='22023'; end if;
   vals:=private.scoring_values(conf,cid,category);
   if vals is null or not (command->>'points')::integer=any(vals) then raise exception 'Invalid scoring value' using errcode='22023'; end if;
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt")
   values(new_id,conf,cid,did,null,rid,category,(command->>'points')::integer,actor,client_time);
 when 'event' then
   vals:=private.scoring_values(conf,cid,ev."categoryId");
   if not coalesce((command->>'undo')::boolean,false) and (vals is null or not (command->>'points')::integer=any(vals)) then raise exception 'Invalid scoring value' using errcode='22023'; end if;
   insert into public.participation_corrections(id,conference_id,committee_id,event_id,points,voided,actor_id)
   values(new_id,conf,cid,ev.id,(command->>'points')::integer,coalesce((command->>'undo')::boolean,false),actor);
 when 'queue' then
   if coalesce((command->>'advance')::boolean,false) then
     update public.speaker_queue set state='completed',updated_at=now() where id=nullif(actual,'empty')::uuid;
   else
     if not private.eligible(conf,cid,did,command) then raise exception 'Delegate must be present' using errcode='22023'; end if;
     insert into public.speaker_queue(id,conference_id,committee_id,"sessionId","delegateId") values(new_id,conf,cid,null,did) on conflict do nothing;
   end if;
 when 'timer' then raise exception 'Timers are kept on each device and are no longer saved' using errcode='22023';
 when 'currentSession' then raise exception 'Sessions follow the published schedule; Chairs no longer choose them' using errcode='22023';
 when 'vote' then
   if exists(select 1 from public.documents where id=rid and "voteMode"='divide' and command->>'choice'='Abstain') then raise exception 'Vote session or mode does not permit this ballot' using errcode='22023'; end if;
   if not exists(select 1 from public.documents where id=rid and status='In Debate') then raise exception 'Voting requires active debate' using errcode='22023'; end if;
   -- Eligibility is the snapshot taken when the ballot opened (section 6), not whoever is present now.
   select status into elig from public.ballot_eligibility where resolution_id=rid and delegate_id=did;
   if not found then raise exception 'Open the ballot before recording votes' using errcode='22023'; end if;
   if elig='Absent' or (elig='Present & Voting' and command->>'choice'='Abstain') then raise exception 'Attendance does not permit vote' using errcode='22023'; end if;
   insert into public.votes(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",choice) values(new_id,conf,cid,null,did,rid,command->>'choice')
   on conflict("resolutionId","delegateId") where "sessionId" is null do update set choice=excluded.choice,revision=votes.revision+1,"createdAt"=now(),updated_at=now();
 when 'document' then
   topic:='documents';
   if not ((requested_role='chair' and ((rec.status='Draft' and target='Submitted') or (rec.status='Printed' and target='In Debate') or (rec.status='In Debate' and target='Closed')))
     or (requested_role='approval' and rec.status in ('Submitted','Review') and target in ('Review','Approved','Draft') and rec.status::text<>target)
     or (requested_role='logistics' and rec.status='Approved' and target='Printed')) then raise exception 'Transition not allowed for this role' using errcode='22023'; end if;
   if target='Draft' and length(trim(coalesce(command->>'comment','')))=0 then raise exception 'A change request requires a comment' using errcode='22023'; end if;
   if target='Closed' then
     if command ? 'method' and command->>'method' is distinct from 'observed' then raise exception 'Unknown voting method' using errcode='22023'; end if;
     if command->>'outcome'='Withdrawn' then result:='Withdrawn';
     elsif command->>'method'='observed' then
       if command->>'outcome' is null or command->>'outcome' not in ('Passed','Failed') then raise exception 'Choose Passed or Failed' using errcode='22023'; end if;
       -- Bound to the ballot the Chair saw: a restart (this Chair or another) bumps documents.revision. A missing or
       -- stale ballotRevision is a stale-write conflict, independent of the generic expected-revision check above.
       if (select m[1]::bigint from regexp_match(command->>'ballotRevision','^([0-9]{1,18})$') m) is distinct from rec.revision then raise sqlstate 'PT409' using message='The ballot was restarted or changed since Clear majority was opened. Choose Clear majority again.'; end if;
       select coalesce(c.voting_rule,f.voting_rule) into rule from public.committees c join public.conferences f on f.id=c.conference_id where c.id=cid;
       if rec."voteMode"='divide' then raise exception 'Divide the House needs a counted roll call' using errcode='22023'; end if;
       if rule is distinct from 'simple_majority' then raise exception 'A two-thirds vote needs counted ballots' using errcode='22023'; end if;
       if rec."voteType"='substantive' and (select "vetoEnabled" from public.committees where id=cid) then raise exception 'Only counted ballots can show that no veto was cast' using errcode='22023'; end if;
       select count(*) into n from public.ballot_eligibility where resolution_id=rid and status<>'Absent';
       if n=0 then raise exception 'No delegation is present in this ballot' using errcode='22023'; end if;
       result:=(command->>'outcome')::public.document_outcome;
     else
       select count(*) into n from public.ballot_eligibility where resolution_id=rid and status<>'Absent';
       if n=0 or n<>(select count(*) from public.votes v join public.ballot_eligibility b on b.resolution_id=v."resolutionId" and b.delegate_id=v."delegateId" and b.status<>'Absent' where v."resolutionId"=rid and v."sessionId" is null) then raise exception 'Record every eligible ballot before closing' using errcode='22023'; end if;
       select count(*) filter(where choice='For'),count(*) filter(where choice='Against') into yes_votes,no_votes from public.votes where "resolutionId"=rid and "sessionId" is null;
       select coalesce(c.voting_rule,f.voting_rule) into rule from public.committees c join public.conferences f on f.id=c.conference_id where c.id=cid;
       result:=case when yes_votes+no_votes>0 and ((rule='simple_majority' and yes_votes>no_votes) or (rule='two_thirds' and yes_votes*3>=(yes_votes+no_votes)*2)) then 'Passed'::public.document_outcome else 'Failed'::public.document_outcome end;
       if cardinality(private.veto_delegates(rid))>0 then result:='Failed'; end if;
       if command->>'outcome' is distinct from result::text then raise exception 'Outcome differs from configured voting rule' using errcode='22023'; end if;
     end if;
   end if;
   update public.documents set "vetoedBy"=case when target='Closed' and result<>'Withdrawn' then private.veto_delegates(rid) else "vetoedBy" end,
    status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;
   if target='Closed' and command->>'method'='observed' and result<>'Withdrawn' then
     update public.documents set "outcomeMethod"='observed',"declaredBy"=actor,"declaredAt"=client_time,
      "declaredByName"=(select s.name from public.staff s where s.auth_user_id=actor and s.conference_id=conf limit 1) where id=rid;
   end if;
   if length(trim(coalesce(command->>'comment','')))>0 then insert into public.document_comments(id,conference_id,committee_id,"documentId",text,"authorId") values(new_id,conf,cid,rid,command->>'comment',actor); end if;
 when 'version' then
   topic:='documents';
   if rec.status<>'Draft' then raise exception 'New versions require draft state' using errcode='22023'; end if;
   select coalesce(max(number),0)+1 into n from public.document_versions where "documentId"=rid;
   insert into public.document_versions(id,conference_id,committee_id,"documentId",number,"createdBy","fileName",text) values(new_id,conf,cid,rid,n,actor,command->>'fileName',command->>'text');
   update public.documents set revision=revision+1,updated_at=now() where id=rid;
 when 'newDocument' then
   topic:='documents';
   if cid is distinct from (command->>'committeeId')::uuid then raise exception 'Session outside committee' using errcode='22023'; end if;
   insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) select new_id,conf,cid,null,(command->>'submitterId')::uuid,private.next_resolution_code(conf,cid),command->>'title' from public.committees c where c.id=cid;
   insert into public.document_versions(id,conference_id,committee_id,"documentId",number,"createdBy","fileName",text) values(second_id,conf,cid,new_id,1,actor,'draft-preview.txt',command->>'title');
 when 'rollCallCommit' then entity:=private.commit_roll_call(conf,cid,actor,command);
 when 'award' then raise exception 'Award rubrics retired' using errcode='22023';
 when 'committee' then
   topic:='configuration'; insert into public.committees(id,conference_id,code,name,room) values(new_id,conf,trim(command->>'code'),command->>'name',command->>'room');
 when 'session' then
   topic:='configuration'; insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values(new_id,conf,cid,command->>'name',now(),'scheduled');
 when 'school' then
   topic:='configuration'; insert into public.schools(id,conference_id,name) values(new_id,conf,command->>'name');
 when 'delegate' then
   topic:='configuration';
   if command ? 'flag' and not private.valid_flag(command->>'flag') then raise exception 'Invalid country flag' using errcode='22023'; end if;
   update public.delegates set name=command->>'name',email=lower(command->>'email'),country=command->>'country',flag=case when command ? 'flag' then command->>'flag' else flag end,updated_at=now() where id=did and conference_id=conf;
 when 'import' then
   topic:='configuration'; n:=0;
   for row_data in select * from jsonb_array_elements(command->'rows') loop
     n:=n+1;
     if length(trim(row_data->>'name'))=0 or length(trim(row_data->>'country'))=0 or row_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or (row_data ? 'flag' and not private.valid_flag(row_data->>'flag')) then raise exception 'Invalid imported delegate' using errcode='22023'; end if;
     insert into public.delegates(id,conference_id,committee_id,"schoolId",country,flag,name,email) values((substr(mutation::text,1,24)||lpad(to_hex(n),12,'0'))::uuid,conf,(row_data->>'committeeId')::uuid,(row_data->>'schoolId')::uuid,row_data->>'country',coalesce(row_data->>'flag','🌐'),row_data->>'name',lower(row_data->>'email'));
   end loop;
 when 'conference' then
   topic:='configuration'; update public.conferences set name=command->>'name',venue=command->>'venue',date=(command->>'date')::date,updated_at=now() where id=conf;
 when 'feature' then
   topic:='configuration'; update public.conferences set features=jsonb_set(features,array[command->>'name'],command->'enabled'),updated_at=now() where id=conf;
 when 'scoring' then
   topic:='configuration'; select array_agg(value::integer) into vals from jsonb_array_elements_text(command->'values');
   problem:=private.scoring_problem(command->>'id',vals);
   if problem is not null then raise exception '%',problem using errcode='22023'; end if;
   -- Required procedure categories can be established on a blank conference; other codes must already exist.
   select label into label_value from public.scoring_definitions where conference_id=conf and committee_id is null and code=command->>'id';
   label_value:=coalesce(label_value,private.required_scoring_label(command->>'id'));
   if label_value is null then raise exception 'Unknown scoring category' using errcode='22023'; end if;
   insert into public.scoring_definitions(conference_id,committee_id,code,label,values) values(conf,cid,command->>'id',label_value,vals)
   on conflict(conference_id,committee_id,code) do update set values=excluded.values,updated_at=now();
 when 'criterion' then raise exception 'Award rubrics retired' using errcode='22023';
 when 'staffContact' then
   topic:='configuration'; update public.staff set email=nullif(btrim(command->>'email'),''),"contactRevision"="contactRevision"+1,updated_at=now() where id=(command->>'id')::uuid and conference_id=conf;
 when 'staff' then
   topic:='configuration'; insert into public.staff(id,conference_id,name,email) values(new_id,conf,command->>'name',nullif(btrim(command->>'email'),''));
   insert into public.conference_staff(conference_id,staff_id,role) values(conf,new_id,(command->>'role')::public.conference_role);
   for row_data in select * from jsonb_array_elements(command->'committeeIds') loop insert into public.committee_staff(conference_id,committee_id,staff_id) values(conf,(row_data#>>'{}')::uuid,new_id); end loop;
 else raise exception 'Unknown conference command' using errcode='22023';
 end case;
 entity:=coalesce(rid,did,ev.id,cid,conf);
 if kind<>'queue' then insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values(conf,cid,actor,case when kind='document' then 'Resolution → '||target else kind||' updated' end,entity,mutation,command); end if;
 insert into private.mutation_receipts(id,conference_id,actor_id,payload) values(mutation,conf,actor,payload);
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,topic,mutation);
end; $function$;

CREATE OR REPLACE FUNCTION public.conference_snapshot(conf uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; countries jsonb;
begin
 if not exists(select 1 from public.conferences where id=conf) then raise exception 'Conference access has not been granted' using errcode='42501'; end if;
 countries:=private.document_submitter_countries(conf);
 select jsonb_build_object(
 'conference',(select jsonb_build_object('id',id,'name',name,'venue',venue,'date',date,'features',features,'votingRule',voting_rule) from public.conferences where id=conf),
 'committees',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('conferenceId',conference_id,'votingRule',voting_rule,'scoringOverrides',(select jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values)) from public.scoring_definitions s where s.committee_id=x.id)) order by x.created_at,x.id),'[]') from public.committees x where conference_id=conf),
 'schools',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.schools x where conference_id=conf),
 'staff',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('role',coalesce((select role::text from public.conference_staff f where f.staff_id=x.id limit 1),'chair'),'committeeIds',(select coalesce(jsonb_agg(committee_id),'[]') from public.committee_staff a where a.staff_id=x.id)) order by x.created_at,x.id),'[]') from public.staff x where conference_id=conf),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.sessions x where conference_id=conf),
 'delegates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.delegates x where conference_id=conf),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.attendance x where conference_id=conf),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id,'submitterCountry',countries->>x.id::text,'versionIds',(select coalesce(jsonb_agg(v.id order by number),'[]') from public.document_versions v where v."documentId"=x.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'authorId',"authorId",'createdAt',"createdAt") order by "createdAt"),'[]') from public.document_comments c where c."documentId"=x.id)) order by x.created_at,x.id),'[]') from public.documents x where conference_id=conf),
 'versions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.document_versions x where conference_id=conf),
 'events',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',x.committee_id,'speechId',(select e."speechId" from public.participation_events e where e.id=x.id),'classification',(select e.classification from public.participation_events e where e.id=x.id),'yieldedFrom',(select e."yieldedFrom" from public.participation_events e where e.id=x.id),'points',effective_points,'voidedAt',voided_at,'updatedAt',corrected_at,'revision',(select count(*) from public.participation_corrections c where c.event_id=x.id)) order by x.created_at,x.id),'[]') from public.participation_history x where conference_id=conf),
 'queue',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.speaker_queue x where conference_id=conf and state='active'),
 'votes',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.votes x where conference_id=conf),
 'scoring',(select coalesce(jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values) order by x.created_at,x.id),'[]') from public.scoring_definitions x where conference_id=conf and committee_id is null),
 'criteria',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.award_criteria x where conference_id=conf),
 'awardScores',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.award_scores x where conference_id=conf),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.audit_log x where conference_id=conf),
 'timers','{}'::jsonb
 ) into result;
 return result || jsonb_build_object(
 'debateStates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'id' || jsonb_build_object('committeeId',committee_id)),'[]') from public.debate_states x where conference_id=conf),
 'speeches',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id' || jsonb_build_object('committeeId',committee_id)),'[]') from public.speeches x where conference_id=conf),
 'rollCalls',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'committeeId',r.committee_id,'copiedFrom',r.copied_from,'observedAt',r.observed_at,'committedAt',r.local_committed_at,'effectiveAt',r.effective_at,'timeConfidence',r.time_confidence,'legacy',r.legacy,'rows',(select coalesce(jsonb_agg(jsonb_build_object('delegateId',x.delegate_id,'status',x.status) order by x.delegate_id),'[]') from public.roll_call_row x where x.roll_call_id=r.id and x.revision=r.revision)) order by r.effective_at,r.id,r.revision),'[]') from public.roll_call r where r.conference_id=conf and r.state='committed'),
 'ballots',(select coalesce(jsonb_agg(jsonb_build_object('resolutionId',b.resolution_id,'delegateId',b.delegate_id,'status',b.status,'committeeId',b.committee_id) order by b.resolution_id,b.delegate_id),'[]') from public.ballot_eligibility b where b.conference_id=conf),
 'poiQueue',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'),'[]') from public.poi_queue x where conference_id=conf));
end; $function$;

CREATE OR REPLACE FUNCTION public.executive_snapshot(conf uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare countries jsonb;
begin
 if not exists(select 1 from public.conferences where id=conf) then
  raise exception 'Conference access has not been granted' using errcode='42501';
 end if;
 countries:=private.document_submitter_countries(conf);
 return jsonb_build_object(
 'conference',(select jsonb_build_object('id',id,'name',name,'venue',venue,'date',date,'features',features,'votingRule',voting_rule) from public.conferences where id=conf),
 'committees',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('conferenceId',conference_id,'votingRule',voting_rule,'scoringOverrides',(select jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values)) from public.scoring_definitions s where s.committee_id=x.id)) order by x.created_at,x.id),'[]') from public.committees x where conference_id=conf),
 'schools',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.schools x where conference_id=conf),
 'staff',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('role',coalesce((select role::text from public.conference_staff f where f.staff_id=x.id limit 1),'chair'),'committeeIds',(select coalesce(jsonb_agg(committee_id),'[]') from public.committee_staff a where a.staff_id=x.id)) order by x.created_at,x.id),'[]') from public.staff x where conference_id=conf),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.sessions x where conference_id=conf),
 'delegates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.delegates x where conference_id=conf),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.attendance x where conference_id=conf),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id,'submitterCountry',countries->>x.id::text,'versionIds',(select coalesce(jsonb_agg(v.id order by number),'[]') from public.document_versions v where v."documentId"=x.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'authorId',"authorId",'createdAt',"createdAt") order by "createdAt"),'[]') from public.document_comments c where c."documentId"=x.id)) order by x.created_at,x.id),'[]') from public.documents x where conference_id=conf),
 'scoring',(select coalesce(jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values) order by x.created_at,x.id),'[]') from public.scoring_definitions x where conference_id=conf and committee_id is null),
 'audit',(select coalesce(jsonb_agg(to_jsonb(recent) order by recent."createdAt",recent.id),'[]'::jsonb) from (
   select id,"actorId",action,"entityId","createdAt" from public.audit_log
   where conference_id=conf order by "createdAt" desc,id desc limit 50
 ) recent),
 'versions','[]'::jsonb,
 'events','[]'::jsonb,
 'queue','[]'::jsonb,
 'votes','[]'::jsonb,
 'criteria','[]'::jsonb,
 'awardScores','[]'::jsonb,
 'debateStates','[]'::jsonb,
 'speeches','[]'::jsonb,
 'poiQueue','[]'::jsonb,
 'timers','{}'::jsonb,
 'rollCalls',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'committeeId',r.committee_id,'copiedFrom',r.copied_from,'observedAt',r.observed_at,'committedAt',r.local_committed_at,'effectiveAt',r.effective_at,'timeConfidence',r.time_confidence,'legacy',r.legacy,'rows',(select coalesce(jsonb_agg(jsonb_build_object('delegateId',x.delegate_id,'status',x.status) order by x.delegate_id),'[]') from public.roll_call_row x where x.roll_call_id=r.id and x.revision=r.revision)) order by r.committee_id),'[]')
   from (select distinct on (l.committee_id) l.* from public.roll_call l where l.conference_id=conf and l.state='committed' and l.effective_at is not null order by l.committee_id, l.effective_at desc, l.id desc, l.revision desc) r),
 'ballots','[]'::jsonb
 );
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_amendment(link_token text, submission uuid, submitter uuid, resolution uuid, amendment_type text, clause text, wording text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.amendment_links;c public.committees;doc public.documents;prior private.amendment_submissions;existing uuid;
 p jsonb:=jsonb_build_object('submitter',submitter,'resolution',resolution,'type',amendment_type,'clause',btrim(clause),'wording',btrim(wording));
begin
 perform private.lock_lifecycle();
 if submission is null then raise exception 'idempotency_conflict' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(submission::text,0));
 -- Committee lock matches Chair lifecycle writes. Recheck the link after acquiring it.
 select * into l from public.amendment_links where token=link_token and revoked_at is null and private.lifecycle_allows(test_only);
 if not found then raise exception 'invalid_link' using errcode='22023';end if;
 select * into c from public.committees where id=l.committee_id for update;
 select * into l from public.amendment_links where token=link_token and revoked_at is null and private.lifecycle_allows(test_only);
 if not found or c.archived then raise exception 'invalid_link' using errcode='22023';end if;
 select * into prior from private.amendment_submissions where id=submission;
 if found then
  if prior.link_id<>l.id or prior.payload<>p then raise exception 'idempotency_conflict' using errcode='22023';end if;
  return jsonb_build_object('status','replayed','id',prior.amendment_id);
 end if;
 -- The resolution in debate in this committee owns the amendment (section 8); there is no session pointer to match any more.
 select * into doc from public.documents where id=resolution and committee_id=l.committee_id and status='In Debate';
 if not found then raise exception 'not_open' using errcode='22023';end if;
 if not exists(select 1 from public.delegates where id=submitter and committee_id=l.committee_id and conference_id=l.conference_id) then raise exception 'invalid_submitter' using errcode='22023';end if;
 if amendment_type is null or amendment_type not in ('Add','Strike','Replace') or coalesce(length(btrim(clause)),0) not between 1 and 200 or coalesce(length(btrim(wording)),0) not between 1 and 4000 then raise exception 'invalid_amendment' using errcode='22023';end if;
 select a.id into existing from public.amendments a where a."resolutionId"=resolution and a."submitterId"=submitter and a.type=amendment_type and a.clause=btrim(submit_amendment.clause) and a.wording=btrim(submit_amendment.wording) order by a."createdAt" limit 1;
 if existing is not null then return jsonb_build_object('status','duplicate','id',existing);end if;
 if (select count(*) from private.amendment_submissions where link_id=l.id and created_at>now()-interval '10 minutes')>=20 or (select count(*) from public.amendments where "submitterId"=submitter and committee_id=l.committee_id and "createdAt">now()-interval '10 minutes')>=5 then raise exception 'rate_limited' using errcode='P0001';end if;
 insert into public.amendments(id,conference_id,committee_id,"resolutionId","sessionId","submitterId",type,clause,wording) values(submission,l.conference_id,l.committee_id,resolution,null,submitter,amendment_type,btrim(clause),btrim(wording));
 insert into private.amendment_submissions(id,link_id,amendment_id,payload) values(submission,l.id,submission,p);
 -- Delegate is not an auth user: its immutable submission record is the public action's audit trail.
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(l.conference_id,l.committee_id,'documents',submission);
 return jsonb_build_object('status','created','id',submission);
end $function$;

CREATE OR REPLACE FUNCTION public.submit_resolution(link_token text, submission uuid, submitter uuid, title text, google_doc_id text, file_name text, storage_key text, file_sha256 text, file_size integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 link public.submission_links; existing private.resolution_submissions; sid uuid; n integer; doc_code text; committee_code text;
 doc_id uuid := (substr(submission::text,1,24)||'000000000001')::uuid;
 version_id uuid := (substr(submission::text,1,24)||'000000000002')::uuid;
 submitter_country text; request_payload jsonb;
begin
 perform private.lock_lifecycle();
 select * into link from public.submission_links where token = link_token and revoked_at is null and private.lifecycle_allows(test_only);
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
 if not exists(select 1 from public.submission_links where id=link.id and revoked_at is null and private.lifecycle_allows(test_only)) then raise exception 'invalid_link' using errcode='P0001'; end if;
 select * into existing from private.resolution_submissions where id = submission;
 if found then
   if existing.link_id <> link.id or existing.conference_id <> link.conference_id or existing.committee_id <> link.committee_id
      or existing.request_payload is distinct from request_payload then
     raise exception 'idempotency_conflict' using errcode='22023';
   end if;
   return jsonb_build_object('status','replayed','code',(select code from public.documents where id = existing.document_id));
 end if;
 if not exists(select 1 from public.committees where id=link.committee_id and conference_id=link.conference_id and not archived) then raise exception 'invalid_link' using errcode='P0001';end if;
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
 -- Sessions are labels now (section 8): a resolution belongs to its committee, not to a session.
 sid := null;
 select code into committee_code from public.committees where id = link.committee_id;
 doc_code := private.next_resolution_code(link.conference_id, link.committee_id);
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
end; $function$;

CREATE OR REPLACE FUNCTION private.ops_point_adjustment(conf uuid, cid uuid, actor uuid, new_id uuid, command jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 act text := command->>'action'; delegate_id uuid := private.uuid_or_null(command->>'delegateId'); sid uuid := private.uuid_or_null(command->>'sessionId');
 raw text := command->>'amount'; amt integer; why text; orig public.participation_adjustments; chair_name text;
begin
 select s.name into chair_name from public.staff s where s.auth_user_id = actor and s.conference_id = conf limit 1;
 if act = 'deduct' then
  if jsonb_typeof(command->'amount') is distinct from 'number' or raw !~ '^[0-9]{1,2}$' then raise exception 'Enter a whole number of points from 1 to 20.' using errcode = '22023'; end if;
  amt := raw::integer;
  if amt not between 1 and 20 then raise exception 'Enter a whole number of points from 1 to 20.' using errcode = '22023'; end if;
  why := btrim(coalesce(command->>'reason', ''));
  if char_length(why) not between 3 and 300 then raise exception 'Give a reason of 3 to 300 characters.' using errcode = '22023'; end if;
  -- A session in the command (older builds) is accepted only as this committee's; the deduction itself is committee-level and labelled by the schedule.
  if sid is not null and not exists (select 1 from public.sessions where id = sid and conference_id = conf and committee_id = cid) then raise exception 'Session unavailable' using errcode = '22023'; end if;
  perform private.require_operational_committee(conf, cid);
  insert into public.participation_adjustments(id, conference_id, committee_id, "delegateId", "sessionId", points, reason, "chairId", "chairName")
  values (new_id, conf, cid, delegate_id, null, -amt, why, actor, chair_name);
 elsif act = 'restore' then
  select * into orig from public.participation_adjustments where id = private.uuid_or_null(command->>'adjustmentId') and conference_id = conf and committee_id = cid for update;
  if not found then raise exception 'Adjustment unavailable' using errcode = '22023'; end if;
  if orig.points >= 0 or orig."delegateId" <> delegate_id then raise exception 'Only a deduction for this delegate can be restored.' using errcode = '22023'; end if;
  -- Same archive boundary as a new deduction: an archived session or committee is history and its totals do not move.
  perform private.require_operational_committee(conf, cid);
  if exists (select 1 from public.participation_adjustments where reverses = orig.id) then
   raise sqlstate 'PT409' using message = 'This deduction was already restored on another device.';
  end if;
  why := btrim(coalesce(nullif(command->>'reason', ''), 'Deduction restored'));
  if char_length(why) not between 3 and 300 then raise exception 'Give a reason of 3 to 300 characters.' using errcode = '22023'; end if;
  insert into public.participation_adjustments(id, conference_id, committee_id, "delegateId", "sessionId", points, reason, "chairId", "chairName", reverses)
  values (new_id, conf, cid, orig."delegateId", orig."sessionId", -orig.points, why, actor, chair_name, orig.id);
 else raise exception 'Unknown adjustment action' using errcode = '22023';
 end if;
 return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.apply_conference_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$ begin
 if command->>'type' in ('committeeUpdate','committeeLifecycle','sessionSlot','amendmentLink','amendmentStatus') then
  perform private.apply_staff_batch(conf,mutation,command,requested_role,expected,client_time);
 elsif command->>'type' in ('debateMode','queueAdd','queueOrder','queueRemove','speechStart','speechYield','speechScore','speechFinish','poiAllowance','poiAdd','poiOrder','poiRecognize','poiScore','poiRemove','voteMode','vetoRules') then
  perform private.apply_procedure(conf,mutation,command,requested_role,expected,client_time);
 else perform private.apply_mutation(conf,mutation,command,requested_role,expected,client_time);end if;
end $function$;

CREATE OR REPLACE FUNCTION private.apply_staff_batch(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid:=auth.uid();kind text:=command->>'type';action text:=command->>'action';cid uuid;entity uuid;sid uuid;
 new_id uuid:=(substr(mutation::text,1,24)||'000000000001')::uuid;counter integer:=1;
 prior private.mutation_receipts;actual text;slot public.conference_session_slots;committee public.committees;amend public.amendments;
 payload jsonb:=jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
 topic text:='configuration';target text:=command->>'status';outcome_value text:=command->>'outcome';
begin
 perform private.lock_lifecycle();
 if actor is null then raise exception 'Session required' using errcode='42501';end if;
 if pg_column_size(command)>16384 then raise exception 'Command too large' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 select * into prior from private.mutation_receipts where id=mutation;
 if found then
  if prior.actor_id<>actor or prior.conference_id<>conf or prior.payload<>payload then raise exception 'Idempotency key reused for a different action' using errcode='22023';end if;return;
 end if;
 if kind='amendmentStatus' then select * into amend from public.amendments where id=(command->>'id')::uuid and conference_id=conf;cid:=amend.committee_id;
 elsif kind in ('committeeUpdate','committeeLifecycle') then cid:=(command->>'id')::uuid;
 elsif kind='amendmentLink' then cid:=(command->>'committeeId')::uuid;end if;
 if requested_role is distinct from (case when kind='amendmentStatus' then 'chair'::public.conference_role else 'admin'::public.conference_role end)
 or not private.has_access(conf,cid,array[requested_role]) then raise exception 'Access denied' using errcode='42501';end if;
 -- Serialize configuration without blocking grant/audit foreign-key KEY SHARE locks.
 if kind<>'amendmentStatus' then perform 1 from public.conferences where id=conf for no key update;end if;
 if cid is not null then select * into committee from public.committees where id=cid and conference_id=conf for update;
  if not found then raise exception 'Committee unavailable' using errcode='42501';end if;
 else perform 1 from public.committees where conference_id=conf order by id for update;end if;
 if kind='amendmentStatus' then
  select * into amend from public.amendments where id=(command->>'id')::uuid and conference_id=conf for update;actual:=amend.revision::text;
 elsif kind in ('committeeUpdate','committeeLifecycle') then actual:=committee.revision::text;
 elsif kind='sessionSlot' and action<>'create' then select * into slot from public.conference_session_slots where id=(command->>'id')::uuid and conference_id=conf for update;actual:=slot.revision::text;
 elsif kind='amendmentLink' then select coalesce((select id::text from public.amendment_links where committee_id=cid and revoked_at is null),'none') into actual;end if;
 if (kind in ('amendmentStatus','committeeUpdate','committeeLifecycle') or (kind='sessionSlot' and action<>'create')) and actual is null then raise exception 'Record unavailable' using errcode='42501';end if;
 if actual is not null and actual is distinct from expected then raise exception 'This record changed. Review before retrying.' using errcode='PT409';end if;
 entity:=coalesce(cid,slot.id,new_id);
 case kind
 when 'committeeUpdate' then
  if coalesce(length(btrim(command->>'code')),0) not between 1 and 30 or coalesce(length(btrim(command->>'name')),0) not between 1 and 200 or coalesce(length(command->>'room'),0)>200 then raise exception 'Enter a valid committee code, name and room' using errcode='22023';end if;
  update public.committees set code=btrim(command->>'code'),name=btrim(command->>'name'),room=btrim(command->>'room'),revision=revision+1 where id=cid;
 when 'committeeLifecycle' then
  if action='archive' then
   if exists(select 1 from public.documents where committee_id=cid and status='In Debate') then raise exception 'Close the current resolution debate before archiving this committee.' using errcode='22023';end if;
   update public.committees set archived=true,revision=revision+1,"currentSessionId"=null,"sessionRevision"="sessionRevision"+1 where id=cid;
   -- The committee lock serializes rotation. Credential locks serialize redemption;
   -- revoke grants only after all in-flight successful redemptions have committed.
   update private.access_credentials set revoked_at=now(),updated_at=now() where conference_id=conf and committee_id=cid and role='chair' and revoked_at is null;
   update public.user_access set revoked_at=now(),updated_at=now() where conference_id=conf and committee_id=cid and role='chair' and revoked_at is null;
  elsif action='delete' then
   if private.batch_has_references('public.committees',cid,array['public.sessions'::regclass,'public.operational_changes'::regclass,'public.audit_log'::regclass]) then raise exception 'Committee has linked records. Archive it to preserve history.' using errcode='22023';end if;
   for sid in select id from public.sessions where committee_id=cid loop
    if private.batch_session_used(sid) then raise exception 'Committee sessions have history. Archive the committee instead.' using errcode='22023';end if;
   end loop;
   -- Invalidation rows are transient; audit content survives with its entity UUID.
   delete from public.operational_changes where conference_id=conf and committee_id=cid;
   update public.audit_log set committee_id=null where conference_id=conf and committee_id=cid;
   delete from public.sessions where committee_id=cid;delete from public.committees where id=cid;
  else raise exception 'Unknown committee action' using errcode='22023';end if;
  -- Audit references the preserved entity UUID without retaining a FK to a deleted committee.
  cid:=null;
 when 'sessionSlot' then
  if action='create' then
   insert into public.conference_session_slots(id,conference_id,name,"startsAt","endsAt") values(new_id,conf,btrim(command->>'name'),(command->>'startsAt')::timestamptz,(command->>'endsAt')::timestamptz);
   for committee in select * from public.committees where conference_id=conf and not archived order by id loop
    counter:=counter+1;
    insert into public.sessions(id,conference_id,committee_id,"slotId",name,"startsAt","endsAt",state) values((substr(mutation::text,1,24)||lpad(to_hex(counter),12,'0'))::uuid,conf,committee.id,new_id,btrim(command->>'name'),(command->>'startsAt')::timestamptz,(command->>'endsAt')::timestamptz,'scheduled');
   end loop;
  elsif action='update' then
   if slot.archived then raise exception 'Archived session cannot be edited' using errcode='22023';end if;
   update public.conference_session_slots set name=btrim(command->>'name'),"startsAt"=(command->>'startsAt')::timestamptz,"endsAt"=(command->>'endsAt')::timestamptz,revision=revision+1 where id=slot.id;
   update public.sessions set name=btrim(command->>'name'),"startsAt"=(command->>'startsAt')::timestamptz,"endsAt"=(command->>'endsAt')::timestamptz where "slotId"=slot.id;
  elsif action='archive' then
   update public.conference_session_slots set archived=true,revision=revision+1 where id=slot.id;
   update public.sessions set archived=true,state='closed' where "slotId"=slot.id;
   update public.committees set "currentSessionId"=null,"sessionRevision"="sessionRevision"+1 where "currentSessionId" in (select id from public.sessions where "slotId"=slot.id);
  elsif action='delete' then
   for sid in select id from public.sessions where "slotId"=slot.id loop
    if private.batch_session_used(sid) then raise exception 'Session has operational history. Archive the slot instead.' using errcode='22023';end if;
   end loop;
   delete from public.sessions where "slotId"=slot.id;delete from public.conference_session_slots where id=slot.id;
  else raise exception 'Unknown session action' using errcode='22023';end if;
 when 'amendmentLink' then
  topic:='documents';if committee.archived then raise exception 'Committee is archived' using errcode='22023';end if;
  if action='create' and actual<>'none' then raise exception 'An amendment link already exists. Replace it instead.' using errcode='22023';end if;
  if action not in ('create','rotate','revoke') then raise exception 'Unknown link action' using errcode='22023';end if;
  update public.amendment_links set revoked_at=now() where committee_id=cid and revoked_at is null;
  if action<>'revoke' then insert into public.amendment_links(id,conference_id,committee_id,token) values(new_id,conf,cid,command->>'token');end if;
 when 'amendmentStatus' then
  entity:=amend.id;topic:='documents';perform private.require_operational_committee(conf,cid);
  if committee.archived or not exists(select 1 from public.documents where id=amend."resolutionId" and status='In Debate') then raise exception 'Amendments are not currently open in this committee.' using errcode='22023';end if;
  if not coalesce((amend.status='Submitted' and target='Accepted for Debate' and outcome_value is null) or (amend.status='Accepted for Debate' and target='In Debate' and outcome_value is null) or (amend.status<>'Closed' and target='Closed' and (outcome_value in ('Ruled Out','Withdrawn') or (amend.status='In Debate' and outcome_value in ('Passed','Failed')))),false) then raise exception 'Invalid amendment transition' using errcode='22023';end if;
  if target='In Debate' and exists(select 1 from public.amendments where committee_id=cid and status='In Debate' and id<>amend.id) then raise exception 'Close the current amendment debate first' using errcode='22023';end if;
  -- Procedural invariant: start an amendment debate, or close an active one, only with the floor at the Chair.
  if (target='In Debate' or (amend.status='In Debate' and target='Closed')) and exists(select 1 from public.speeches where committee_id=cid and conference_id=conf and state<>'finished' and "sessionId" is null) then raise exception 'Finish the current speech and return the floor to the Chair first.' using errcode='22023';end if;
  update public.amendments set status=target,outcome=outcome_value,revision=revision+1 where id=amend.id;
 else raise exception 'Unknown batch command' using errcode='22023';end case;
 insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values(conf,cid,actor,kind||' updated',entity,mutation,command-'token');
 insert into private.mutation_receipts(id,conference_id,actor_id,payload) values(mutation,conf,actor,payload);
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,topic,mutation);
 -- Central configuration must reach committee-filtered Chair channels without broadening subscriptions.
 if kind='sessionSlot' then
  for committee in select * from public.committees where conference_id=conf loop
   insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,committee.id,'configuration',gen_random_uuid());
  end loop;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION private.hold_gate(conf uuid, cid uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  kind text := command->>'type';
  cls text := private.command_class(kind);
  st private.conference_settings;
  ctx jsonb := nullif(current_setting('munos.mutation_ctx', true), '')::jsonb;
  tz text := private.conference_time_zone(conf);
  received timestamptz; device_time timestamptz; device uuid; seq bigint; confidence text; acted timestamptz; why text;
begin
  if coalesce(current_setting('munos.approving', true), '') = mutation::text then return false; end if;
  if cls is null or requested_role <> 'chair' or cid is null or ctx is null then return false; end if;
  select * into st from private.conference_settings where conference_id = conf;
  if not found or not st.hold_enforcement then return false; end if;
  received := private.session_ts(ctx->>'receivedAt');
  device := private.uuid_or_null(ctx->>'deviceId');
  seq := (ctx->>'deviceSeq')::bigint;
  -- A roll call is admitted by its own commit time, not by the action that carries it (the same instant its effective time and label use).
  device_time := private.command_device_time(command, client_time);
  confidence := private.time_confidence(conf, device, device_time, received);
  acted := case when confidence = 'trusted' then device_time else received end;
  if exists (select 1 from public.conference_day_close c where c.conference_id = conf and c.conference_day = (acted at time zone tz)::date and c.closed_at <= received) then
    why := 'day_closed';
  elsif confidence = 'uncertain' then
    why := 'uncertain_time';
  elsif kind = 'vote' and not exists (select 1 from public.documents d where d.id = private.uuid_or_null(command->>'resolutionId') and d.status = 'In Debate') then
    -- A ballot that arrives after its result was declared is held: closed results are immutable (section 6).
    why := 'ballot_closed';
  elsif cls = 'record' and private.waits_for_held(cid, device, seq, command) then
    why := 'behind_held';
  elsif cls in ('control', 'rollcall') then
    if private.committee_session_at(conf, cid, acted)->>'flag' is not null then why := 'outside_window';
    elsif cls = 'control' and received - client_time > make_interval(mins => st.control_stale_minutes) then why := 'stale';
    elsif private.waits_for_held(cid, device, seq, command) then why := 'behind_held';
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
end $function$;

CREATE OR REPLACE FUNCTION private.veto_delegates(rid uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 -- Counted against the ballot's eligibility snapshot (section 6); votes are keyed by resolution and delegate.
 select coalesce(array_agg(v."delegateId" order by v."delegateId"),'{}') from public.documents d
 join public.committees c on c.id=d.committee_id
 join public.votes v on v."resolutionId"=d.id and v."sessionId" is null and v.choice='Against'
 join public.ballot_eligibility b on b.resolution_id=d.id and b.delegate_id=v."delegateId" and b.status<>'Absent'
 where d.id=rid and c."vetoEnabled" and d."voteType"='substantive' and v."delegateId"=any(c."vetoDelegateIds");
$function$;


-- ---- Classification: roll calls and closed ballots ----------------------------------------------------------------------------
create or replace function private.command_class(kind text) returns text
language sql immutable set search_path='' as $$
  select case
    when kind in ('participation', 'event', 'vote', 'speechScore', 'poiScore', 'pointAdjustment') then 'record'
    when kind in ('queue', 'queueAdd', 'queueOrder', 'queueRemove', 'debateMode', 'speechStart', 'speechYield', 'speechFinish', 'poiAllowance', 'poiAdd',
                  'poiOrder', 'poiRecognize', 'poiRemove', 'voteMode', 'document') then 'control'
    when kind = 'rollCallCommit' then 'rollcall'
  end
$$;

revoke all on function private.held_event_committee(uuid, text), private.waits_for_held(uuid, uuid, bigint, jsonb), private.command_device_time(jsonb, timestamptz), private.require_operational_committee(uuid, uuid), private.action_time(uuid), private.presence_at(uuid, uuid, timestamptz),
  private.eligible(uuid, uuid, uuid, jsonb), private.open_ballot(uuid, uuid, uuid), private.commit_roll_call(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
