-- Session model phase 3a (docs/SESSION_MODEL.md sections 2, 4, 6a and 12.5): the server labels every Record-class row at receipt and
-- classifies the time it can trust. PROTECTED change (patches the three Chair write dispatchers; unapplied; needs independent review).
--
-- This file only LABELS: nothing here holds, rejects or reorders an action. The hold rules (section 4's acceptance table), held-behind
-- ordering and the Executive approve / discard / bulk-approve commands are in 20261030100000_session_holds.sql and are inactive
-- until the Executive switches enforcement on for the conference.
--
-- How it works: each dispatcher records a small per-transaction context (the mutation, its client time and the optional device block
-- `command._device = {deviceId, deviceSeq, displayedLabel}`) before it does anything else. An AFTER trigger on each Record-class table
-- reads that context and writes the row's public.record_label IN THE SAME TRANSACTION as the record, so a record and its label
-- commit or roll back together. A row written with no context (owner SQL) is simply not labelled.
--
--   Record-class tables: participation_events (scores, speech and POI points), participation_corrections, votes, document_comments,
--   participation_adjustments. Control state (queue, speeches, documents' status) and roll calls are not labelled here.
--
-- Time confidence (section 4): Trusted when the server received the action within the tolerance of its device time, or the device's
-- latest clock sync on the same conference day shows an offset within the tolerance. A device time later than receipt by more than
-- the tolerance is Uncertain. The tolerance is conference_settings.time_trust_minutes (default 2, PROPOSED, not approved).
-- The label is computed from the action's device time when it is Trusted, and from the server receipt time otherwise (an
-- Uncertain clock must not pick the session); the row records the confidence either way.

alter table private.conference_settings
  add column time_trust_minutes integer not null default 2 check (time_trust_minutes between 0 and 60);

alter table public.record_label
  add column no_session boolean not null default false,
  add column label_differs boolean not null default false,
  -- true when the device reported what it displayed, including "no session" (an explicit null); false for legacy clients that said nothing.
  add column displayed_reported boolean not null default false,
  -- set when the row was recorded by an Executive-approved held action (20261030100000), linking the record to its review.
  add column held_action_id uuid references public.held_action(id);

create function private.time_confidence(conf uuid, device uuid, client_time timestamptz, received timestamptz) returns text
language plpgsql stable set search_path='' as $$
declare
  tol interval := make_interval(mins => coalesce((select time_trust_minutes from private.conference_settings where conference_id = conf), 2));
  tz text := private.conference_time_zone(conf);
  off bigint;
begin
  if client_time is null or client_time - received > tol then return 'uncertain'; end if;
  if received - client_time <= tol then return 'trusted'; end if;
  if device is null then return 'uncertain'; end if;
  select s.offset_ms into off from public.device_clock_sync s
   where s.conference_id = conf and s.device_id = device and s.conference_day = (client_time at time zone tz)::date
   order by s.synced_at desc limit 1;
  if off is null then return 'uncertain'; end if;
  return case when abs(off) <= extract(epoch from tol) * 1000 then 'trusted' else 'uncertain' end;
end $$;

-- Called first thing by each Chair write dispatcher (after the lifecycle lock). Transaction-local; overwritten by every dispatcher call,
-- so a caller cannot pre-set it. API roles cannot write the labelled tables except through a dispatcher.
create function private.set_mutation_context(conf uuid, mutation uuid, client_time timestamptz, command jsonb) returns void
language plpgsql set search_path='' as $$
declare
  dev jsonb := case when jsonb_typeof(command->'_device') = 'object' then command->'_device' else '{}'::jsonb end;
  approving boolean := coalesce(current_setting('munos.approving', true), '') = mutation::text;
  held public.held_action;
begin
  -- An Executive-approved held action is re-run with its ORIGINAL receipt time, so its label does not depend on when it was approved.
  if approving then select * into held from public.held_action where id = mutation; end if;
  perform set_config('munos.mutation_ctx', jsonb_build_object(
    'conference', conf, 'mutation', mutation,
    'receivedAt', private.session_iso(coalesce(held.received_at, date_trunc('milliseconds', clock_timestamp()))),
    'heldActionId', held.id,
    'confirmedOffsetMs', case when held.id is not null then nullif(current_setting('munos.approval_offset', true), '')::bigint end,
    'clientTime', private.session_iso(client_time),
    'deviceId', private.uuid_or_null(dev->>'deviceId'),
    'deviceSeq', case when dev->>'deviceSeq' ~ '^[0-9]{1,15}$' then (dev->>'deviceSeq')::bigint end,
    'displayedLabel', private.uuid_or_null(dev->>'displayedLabel'),
    'displayedReported', (dev ? 'displayedLabel') and (jsonb_typeof(dev->'displayedLabel') = 'null' or private.uuid_or_null(dev->>'displayedLabel') is not null))::text, true);
end $$;

create function private.label_record() returns trigger
language plpgsql set search_path='' as $$
declare
  ctx jsonb := nullif(current_setting('munos.mutation_ctx', true), '')::jsonb;
  received timestamptz; client timestamptz; device uuid; displayed uuid; reported boolean; held uuid; confirmed bigint; confidence text; acted timestamptz; res jsonb; assigned uuid; flag text;
begin
  if ctx is null or (ctx->>'conference')::uuid is distinct from new.conference_id then return null; end if;
  received := private.session_ts(ctx->>'receivedAt');
  client := private.session_ts(ctx->>'clientTime');
  device := private.uuid_or_null(ctx->>'deviceId');
  displayed := private.uuid_or_null(ctx->>'displayedLabel');
  reported := coalesce((ctx->>'displayedReported')::boolean, false);
  -- A displayed label from another committee is not evidence about this one: dropped, and not reported.
  if displayed is not null and not exists (select 1 from public.sessions where id = displayed and conference_id = new.conference_id and committee_id = new.committee_id) then displayed := null; reported := false; end if;
  held := private.uuid_or_null(ctx->>'heldActionId');
  confirmed := (ctx->>'confirmedOffsetMs')::bigint;
  confidence := private.time_confidence(new.conference_id, device, client, received);
  acted := case when confidence = 'trusted' then client else received end;
  -- The Executive confirmed this device's clock error when approving: its device time, corrected by that error, is trusted.
  if confirmed is not null and client is not null then confidence := 'trusted'; acted := client - confirmed * interval '1 millisecond'; end if;
  res := private.committee_session_at(new.conference_id, new.committee_id, acted);
  assigned := private.uuid_or_null(res->>'sessionId');
  flag := res->>'flag';
  -- Published schedules are operational history, and sessions they name cannot be deleted (see 20261030100000); if one is ever
  -- missing, the score must still be recorded, so the label degrades to "no session" rather than failing the foreign key.
  if assigned is not null and not exists (select 1 from public.sessions where id = assigned) then assigned := null; flag := 'no_session'; end if;
  insert into public.record_label(record_table, record_id, conference_id, committee_id, displayed_label, assigned_label, outside_schedule, no_session,
                                  label_differs, displayed_reported, time_confidence, device_id, device_seq, assigned_at, held_action_id)
  values (tg_table_name, new.id, new.conference_id, new.committee_id, displayed, assigned, coalesce(flag = 'outside_schedule', false), coalesce(flag = 'no_session', false),
          reported and displayed is distinct from assigned, reported, confidence, device, (ctx->>'deviceSeq')::bigint, received, held)
  on conflict (record_table, record_id) do update set
    displayed_label = excluded.displayed_label, assigned_label = excluded.assigned_label, outside_schedule = excluded.outside_schedule,
    no_session = excluded.no_session, label_differs = excluded.label_differs, displayed_reported = excluded.displayed_reported, time_confidence = excluded.time_confidence, held_action_id = excluded.held_action_id,
    device_id = excluded.device_id, device_seq = excluded.device_seq, assigned_at = excluded.assigned_at;
  return null;
end $$;

create trigger label_record after insert on public.participation_events for each row execute function private.label_record();
create trigger label_record after insert on public.participation_corrections for each row execute function private.label_record();
create trigger label_record after insert on public.document_comments for each row execute function private.label_record();
create trigger label_record after insert on public.participation_adjustments for each row execute function private.label_record();
-- A ballot is re-recorded in place when a delegate changes it: the label follows the newest action.
create trigger label_record after insert or update of choice on public.votes for each row execute function private.label_record();

-- Hook the three Chair write dispatchers. Anchors must match exactly once; a changed base refuses the patch.
do $patch$
declare
  signature text;
  definition text;
  anchor constant text := ' perform private.lock_lifecycle();';
begin
  foreach signature in array array[
    'private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
    'private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
    'private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) then raise exception '% lifecycle anchor changed; review record labelling patch', signature; end if;
    execute replace(definition, anchor, anchor || chr(10) || ' perform private.set_mutation_context(conf, mutation, client_time, command);');
  end loop;
end $patch$;

revoke all on function private.time_confidence(uuid, uuid, timestamptz, timestamptz), private.set_mutation_context(uuid, uuid, timestamptz, jsonb),
  private.label_record() from public, anon, authenticated, service_role;
