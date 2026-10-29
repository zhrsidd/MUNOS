-- Session model phase 3a (docs/SESSION_MODEL.md sections 2, 4, 6a and 12.5): the server labels every Record-class row at receipt and
-- classifies the time it can trust. PROTECTED change (patches the three Chair write dispatchers; unapplied; needs independent review).
--
-- LABELS ONLY. Nothing here holds, rejects or reorders an action: every command that was accepted before is accepted now, with the
-- same effects. Holding (section 4's acceptance table), held-behind ordering and the Executive approve / discard / bulk-approve
-- commands are phase 3b, once clients send a device id and clock offset.
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
  add column label_differs boolean not null default false;

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
declare dev jsonb := case when jsonb_typeof(command->'_device') = 'object' then command->'_device' else '{}'::jsonb end;
begin
  perform set_config('munos.mutation_ctx', jsonb_build_object(
    'conference', conf, 'mutation', mutation,
    'receivedAt', private.session_iso(date_trunc('milliseconds', clock_timestamp())),
    'clientTime', private.session_iso(client_time),
    'deviceId', private.uuid_or_null(dev->>'deviceId'),
    'deviceSeq', case when dev->>'deviceSeq' ~ '^[0-9]{1,15}$' then (dev->>'deviceSeq')::bigint end,
    'displayedLabel', private.uuid_or_null(dev->>'displayedLabel'))::text, true);
end $$;

create function private.label_record() returns trigger
language plpgsql set search_path='' as $$
declare
  ctx jsonb := nullif(current_setting('munos.mutation_ctx', true), '')::jsonb;
  received timestamptz; client timestamptz; device uuid; displayed uuid; confidence text; acted timestamptz; res jsonb; assigned uuid; flag text;
begin
  if ctx is null or (ctx->>'conference')::uuid is distinct from new.conference_id then return null; end if;
  received := private.session_ts(ctx->>'receivedAt');
  client := private.session_ts(ctx->>'clientTime');
  device := private.uuid_or_null(ctx->>'deviceId');
  displayed := private.uuid_or_null(ctx->>'displayedLabel');
  if displayed is not null and not exists (select 1 from public.sessions where id = displayed and conference_id = new.conference_id and committee_id = new.committee_id) then displayed := null; end if;
  confidence := private.time_confidence(new.conference_id, device, client, received);
  acted := case when confidence = 'trusted' then client else received end;
  res := private.committee_session_at(new.conference_id, new.committee_id, acted);
  assigned := private.uuid_or_null(res->>'sessionId');
  flag := res->>'flag';
  insert into public.record_label(record_table, record_id, conference_id, committee_id, displayed_label, assigned_label, outside_schedule, no_session,
                                  label_differs, time_confidence, device_id, device_seq, assigned_at)
  values (tg_table_name, new.id, new.conference_id, new.committee_id, displayed, assigned, coalesce(flag = 'outside_schedule', false), coalesce(flag = 'no_session', false),
          displayed is not null and displayed is distinct from assigned, confidence, device, (ctx->>'deviceSeq')::bigint, received)
  on conflict (record_table, record_id) do update set
    displayed_label = excluded.displayed_label, assigned_label = excluded.assigned_label, outside_schedule = excluded.outside_schedule,
    no_session = excluded.no_session, label_differs = excluded.label_differs, time_confidence = excluded.time_confidence,
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
