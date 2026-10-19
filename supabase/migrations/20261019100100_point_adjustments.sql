-- Chair point deductions as traceable adjustments. Additive only: one table, one helper, two in-place patches.
-- Original participation events are never edited or deleted by an adjustment; a delegate's total is the
-- effective event points plus the adjustments. A deduction records amount, reason, Chair and time. A mistaken
-- deduction is undone by a "restore" adjustment that references it (at most once), never by deleting it.
--
-- Command boundary: public.apply_operations_mutation (the existing extension boundary), so authorization,
-- mutation receipts (idempotent replay), PT409 conflicts, audit rows and Realtime notifications are the same as
-- every other extension command. Only a Chair with access to the delegate's committee may write.

create table public.participation_adjustments (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "delegateId" uuid not null, "sessionId" uuid not null,
 -- Signed: a deduction is negative, a restore is positive. Never zero.
 points integer not null check (points <> 0 and points between -20 and 20),
 reason text not null check (char_length(btrim(reason)) between 3 and 300),
 "chairId" uuid not null references auth.users(id), "chairName" text,
 reverses uuid,
 "createdAt" timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key("delegateId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id),
 foreign key(reverses,conference_id,committee_id) references public.participation_adjustments(id,conference_id,committee_id)
);
-- A deduction can be restored once.
create unique index participation_adjustment_once_reversed on public.participation_adjustments(reverses) where reverses is not null;
create index participation_adjustments_delegate_idx on public.participation_adjustments("delegateId", "createdAt");
create index participation_adjustments_conference_idx on public.participation_adjustments(conference_id);
alter table public.participation_adjustments enable row level security;
revoke all on public.participation_adjustments from anon, authenticated;
grant select on public.participation_adjustments to authenticated;
create policy read_authorized on public.participation_adjustments for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));

create function private.ops_point_adjustment(conf uuid, cid uuid, actor uuid, new_id uuid, command jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
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
  if not exists (select 1 from public.sessions where id = sid and conference_id = conf and committee_id = cid) then raise exception 'Session unavailable' using errcode = '22023'; end if;
  perform private.require_operational_session(conf, sid);
  insert into public.participation_adjustments(id, conference_id, committee_id, "delegateId", "sessionId", points, reason, "chairId", "chairName")
  values (new_id, conf, cid, delegate_id, sid, -amt, why, actor, chair_name);
 elsif act = 'restore' then
  select * into orig from public.participation_adjustments where id = private.uuid_or_null(command->>'adjustmentId') and conference_id = conf and committee_id = cid for update;
  if not found then raise exception 'Adjustment unavailable' using errcode = '22023'; end if;
  if orig.points >= 0 or orig."delegateId" <> delegate_id then raise exception 'Only a deduction for this delegate can be restored.' using errcode = '22023'; end if;
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
end $$;
revoke all on function private.ops_point_adjustment(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

do $patch$
declare definition text; marker text;
 procedure_anchor constant text := ' when ''sessionImport'', ''photoSlot'', ''photoImport'' then cid := null;';
 dispatch_anchor constant text := ' when ''photoAck'' then entity := private.ops_photo_ack(conf, cid, actor, command);';
 snapshot_anchor constant text := 'from public.photo_acknowledgements a where a.conference_id = conf)';
begin
 definition := pg_get_functiondef('private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 if length(definition) - length(replace(definition, procedure_anchor, '')) <> length(procedure_anchor) then raise exception 'apply_operations_mutation scope anchor changed; review before applying'; end if;
 if length(definition) - length(replace(definition, dispatch_anchor, '')) <> length(dispatch_anchor) then raise exception 'apply_operations_mutation dispatch anchor changed; review before applying'; end if;
 definition := replace(definition, procedure_anchor, procedure_anchor || E'\n when ''pointAdjustment'' then\n   select committee_id into cid from public.delegates where id = private.uuid_or_null(command->>''delegateId'') and conference_id = conf;\n   if cid is null then raise exception ''Delegate unavailable'' using errcode=''22023''; end if;\n   allowed := array[''chair'']::public.conference_role[]; topic := ''chair'';');
 definition := replace(definition, dispatch_anchor, dispatch_anchor || E'\n when ''pointAdjustment'' then entity := private.ops_point_adjustment(conf, cid, actor, new_id, command);');
 execute definition;
 definition := pg_get_functiondef('public.operations_snapshot(uuid)'::regprocedure);
 if length(definition) - length(replace(definition, snapshot_anchor, '')) <> length(snapshot_anchor) then raise exception 'operations_snapshot anchor changed; review before applying'; end if;
 execute replace(definition, snapshot_anchor, snapshot_anchor || E',\n  ''pointAdjustments'', (select coalesce(jsonb_agg(jsonb_build_object(''id'',p.id,''delegateId'',p."delegateId",''sessionId'',p."sessionId",''points'',p.points,''reason'',p.reason,''chairId'',p."chairId",''chairName'',p."chairName",''reverses'',p.reverses,''createdAt'',p."createdAt") order by p."createdAt", p.id),''[]'')
    from public.participation_adjustments p where p.conference_id = conf)');
end $patch$;
