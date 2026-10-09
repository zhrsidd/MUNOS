-- Procedure usability: configurable scoring from a blank conference, derived country flags,
-- two-stage POIs, top-of-queue recognition and amendment context on speeches.
-- Additive only: two nullable columns, one scope constraint, indexes and private helpers. Existing rows stay
-- valid; RLS, grants, receipts/idempotency and PT409 stale-write semantics are unchanged.
-- The mutation functions are PATCHED in place (pg_get_functiondef + exact anchors that must occur once),
-- like 20261007104501, so earlier patches such as the archived-session guard are preserved. Fail closed.

-- 1) Amendment context on speeches. Participation events reach it through "speechId".
alter table public.amendments add constraint amendments_id_scope unique (id,conference_id,committee_id);
alter table public.speeches add column "amendmentId" uuid,
 add constraint speeches_amendment_scope foreign key ("amendmentId",conference_id,committee_id) references public.amendments(id,conference_id,committee_id);
create index speeches_amendment_idx on public.speeches("amendmentId",conference_id,committee_id) where "amendmentId" is not null;

-- 2) Two-stage POIs: a recognized POI stays queued (the active POI) until it is scored or withdrawn.
alter table public.poi_queue add column "recognizedAt" timestamptz;
create unique index poi_one_recognized on public.poi_queue("speechId") where "recognizedAt" is not null;

-- 3) Scoring and flag helpers. Speech/POI have built-in defaults; Main Submitter is fixed. Mirrored in lib/scoring.ts.
create function private.required_scoring_label(category text) returns text language sql immutable set search_path='' as $$
 select case category when 'speech' then 'Speech' when 'poi' then 'POI' end $$;
-- Main Submitter is a fixed +5 credit (once per resolution), never configurable or overridable.
create function private.scoring_values(conf uuid,cid uuid,category text) returns integer[] language sql stable set search_path='' as $$
 select case when category='submitter' then array[5] else coalesce(
  (select s.values from public.scoring_definitions s where s.conference_id=conf and s.code=category and (s.committee_id=cid or s.committee_id is null) order by s.committee_id nulls last limit 1),
  case category when 'speech' then array[1,2,3] when 'poi' then array[1,2] end) end $$;
create function private.scoring_problem(category text,vals integer[]) returns text language sql immutable set search_path='' as $$
 select case
  when category='submitter' then 'Main Submitter credit is fixed at +5 and cannot be changed.'
  when vals is null or cardinality(vals) not between 1 and 10 or exists(select 1 from unnest(vals) v where v is null or v<0 or v>20) then 'Use 1–10 whole-number points from 0 to 20.'
  when cardinality(vals)<>(select count(distinct v) from unnest(vals) v) then 'Each point value may appear only once.'
 end $$;
-- Two regional-indicator letters (a client-derived country flag) or the unknown-country globe.
create function private.valid_flag(value text) returns boolean language sql immutable set search_path='' as $$
 select value ~ '^(🌐|[🇦-🇿][🇦-🇿])$' $$;
revoke all on function private.required_scoring_label(text) from public,anon,authenticated;
revoke all on function private.scoring_values(uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.scoring_problem(text,integer[]) from public,anon,authenticated;
revoke all on function private.valid_flag(text) from public,anon,authenticated;

-- Replace exactly one occurrence of an anchor or stop the migration.
create function pg_temp.patch_once(definition text,anchor text,replacement text,label text) returns text language plpgsql as $$
begin
 if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception '% changed; review before applying',label; end if;
 return replace(definition,anchor,replacement);
end $$;

-- 4) private.apply_mutation: participation and correction values use private.scoring_values; the scoring
--    command validates values, refuses Main Submitter, and can establish speech/POI on a blank conference; delegate edit
--    and import store the client-derived flag (validated), defaulting to 🌐.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 definition:=pg_temp.patch_once(definition,
  $q$ row_data jsonb; category text; topic text:='chair';$q$,
  $q$ row_data jsonb; category text; topic text:='chair'; label_value text; problem text;$q$,'apply_mutation anchor 1');
 definition:=pg_temp.patch_once(definition,
  $q$   select values into vals from public.scoring_definitions where conference_id=conf and code=category and (committee_id=cid or committee_id is null) order by committee_id nulls last limit 1;
   if vals is null or not (command->>'points')::integer=any(vals) then raise exception 'Invalid scoring value' using errcode='22023'; end if;$q$,
  $q$   vals:=private.scoring_values(conf,cid,category);
   if vals is null or not (command->>'points')::integer=any(vals) then raise exception 'Invalid scoring value' using errcode='22023'; end if;$q$,'apply_mutation anchor 2');
 definition:=pg_temp.patch_once(definition,
  $q$   select values into vals from public.scoring_definitions where conference_id=conf and code=ev."categoryId" and (committee_id=cid or committee_id is null) order by committee_id nulls last limit 1;$q$,
  $q$   vals:=private.scoring_values(conf,cid,ev."categoryId");$q$,'apply_mutation anchor 3');
 definition:=pg_temp.patch_once(definition,
  $q$   topic:='configuration'; update public.delegates set name=command->>'name',email=lower(command->>'email'),country=command->>'country',updated_at=now() where id=did and conference_id=conf;$q$,
  $q$   topic:='configuration';
   if command ? 'flag' and not private.valid_flag(command->>'flag') then raise exception 'Invalid country flag' using errcode='22023'; end if;
   update public.delegates set name=command->>'name',email=lower(command->>'email'),country=command->>'country',flag=case when command ? 'flag' then command->>'flag' else flag end,updated_at=now() where id=did and conference_id=conf;$q$,'apply_mutation anchor 4');
 definition:=pg_temp.patch_once(definition,
  $q$     if length(trim(row_data->>'name'))=0 or length(trim(row_data->>'country'))=0 or row_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid imported delegate' using errcode='22023'; end if;
     insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email) values((substr(mutation::text,1,24)||lpad(to_hex(n),12,'0'))::uuid,conf,(row_data->>'committeeId')::uuid,(row_data->>'schoolId')::uuid,row_data->>'country',row_data->>'name',lower(row_data->>'email'));$q$,
  $q$     if length(trim(row_data->>'name'))=0 or length(trim(row_data->>'country'))=0 or row_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or (row_data ? 'flag' and not private.valid_flag(row_data->>'flag')) then raise exception 'Invalid imported delegate' using errcode='22023'; end if;
     insert into public.delegates(id,conference_id,committee_id,"schoolId",country,flag,name,email) values((substr(mutation::text,1,24)||lpad(to_hex(n),12,'0'))::uuid,conf,(row_data->>'committeeId')::uuid,(row_data->>'schoolId')::uuid,row_data->>'country',coalesce(row_data->>'flag','🌐'),row_data->>'name',lower(row_data->>'email'));$q$,'apply_mutation anchor 5');
 definition:=pg_temp.patch_once(definition,
  $q$   topic:='configuration'; select array_agg(value::integer) into vals from jsonb_array_elements_text(command->'values');
   insert into public.scoring_definitions(conference_id,committee_id,code,label,values) select conf,cid,command->>'id',label,vals from public.scoring_definitions where conference_id=conf and committee_id is null and code=command->>'id'
   on conflict(conference_id,committee_id,code) do update set values=excluded.values,updated_at=now();$q$,
  $q$   topic:='configuration'; select array_agg(value::integer) into vals from jsonb_array_elements_text(command->'values');
   problem:=private.scoring_problem(command->>'id',vals);
   if problem is not null then raise exception '%',problem using errcode='22023'; end if;
   -- Required procedure categories can be established on a blank conference; other codes must already exist.
   select label into label_value from public.scoring_definitions where conference_id=conf and committee_id is null and code=command->>'id';
   label_value:=coalesce(label_value,private.required_scoring_label(command->>'id'));
   if label_value is null then raise exception 'Unknown scoring category' using errcode='22023'; end if;
   insert into public.scoring_definitions(conference_id,committee_id,code,label,values) values(conf,cid,command->>'id',label_value,vals)
   on conflict(conference_id,committee_id,code) do update set values=excluded.values,updated_at=now();$q$,'apply_mutation anchor 6');
 execute definition;
end $patch$;

-- 5) private.apply_procedure: configured speech/POI/submitter values; speechStart recognizes only the first
--    entry of the active lane and records the In Debate amendment (no Main Submitter speech or Co-Submitter
--    yield in amendment context); yields inherit it; POIs are recognize
--    (no points) → poiScore (exactly one event) or poiRemove. Legacy poiRecognize with points from older
--    saved actions still records exactly once.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 definition:=pg_temp.patch_once(definition,
  $q$  if sp.classification<>'Main Submitter' or sp."resolutionId" is null or did=sp."delegateId" then raise exception 'Only Main Submitter may yield to another delegate' using errcode='22023'; end if;$q$,
  $q$  if sp.classification<>'Main Submitter' or sp."resolutionId" is null or did=sp."delegateId" then raise exception 'Only Main Submitter may yield to another delegate' using errcode='22023'; end if;
  if sp."amendmentId" is not null then raise exception 'Main Submitter and Co-Submitter speeches belong to resolution debate, not amendment debate.' using errcode='22023'; end if;$q$,'apply_procedure anchor 1');
 definition:=pg_temp.patch_once(definition,
  $q$ lane_value text:=command->>'lane'; classification_value text:=command->>'classification'; n integer; points_value integer:=(command->>'points')::integer;$q$,
  $q$ lane_value text:=command->>'lane'; classification_value text:=command->>'classification'; n integer; points_value integer:=(command->>'points')::integer;
 vals integer[]; amend_value uuid; queue_row public.speaker_queue; poi_row public.poi_queue; lane_active text;$q$,'apply_procedure anchor 2');
 definition:=pg_temp.patch_once(definition,
  $q$ elsif kind in ('speechYield','speechFinish','poiAllowance','poiRecognize') then actual:=sp.revision::text;$q$,
  $q$ elsif kind in ('speechYield','speechFinish','poiAllowance','poiRecognize','poiScore','poiRemove') then actual:=sp.revision::text;$q$,'apply_procedure anchor 3');
 definition:=pg_temp.patch_once(definition,
  $q$  if classification_value='Co-Submitter' or (classification_value='Main Submitter' and (rid is null or r."submitterId" is distinct from did)) then raise exception 'Invalid speech relationship' using errcode='22023'; end if;
  if command ? 'entryId' then
   update public.speaker_queue set state='completed' where id=private.uuid_or_null(command->>'entryId') and "sessionId"=sid and "delegateId"=did and state='active';
   if not found then raise sqlstate 'PT409' using message='Queue entry changed'; end if;
  end if;
  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"createdAt") values(new_id,conf,cid,sid,did,rid,classification_value,client_time);$q$,
  $q$  if classification_value='Co-Submitter' or (classification_value='Main Submitter' and (rid is null or r."submitterId" is distinct from did)) then raise exception 'Invalid speech relationship' using errcode='22023'; end if;
  -- A speech during an amendment debate keeps the amendment context (the parent resolution stays In Debate).
  if rid is not null then select id into amend_value from public.amendments where committee_id=cid and conference_id=conf and status='In Debate' and "resolutionId"=rid; end if;
  if command ? 'amendmentId' and private.uuid_or_null(command->>'amendmentId') is distinct from amend_value then raise sqlstate 'PT409' using message='The amendment debate changed. Review the Debate Console.'; end if;
  if amend_value is not null and classification_value='Main Submitter' then raise exception 'Main Submitter and Co-Submitter speeches belong to resolution debate, not amendment debate.' using errcode='22023'; end if;
  if command ? 'entryId' then
   select * into queue_row from public.speaker_queue where id=private.uuid_or_null(command->>'entryId') and "sessionId"=sid and "delegateId"=did and state='active';
   if not found then raise sqlstate 'PT409' using message='Queue entry changed'; end if;
   -- Only the first speaker of the active lane (open debate, or the current For/Against phase) is recognized.
   select case when coalesce(ds.mode,'open')='open' then 'open' else ds.phase end into lane_active from (select 1) one left join public.debate_states ds on ds."sessionId"=sid;
   if queue_row.lane is distinct from lane_active or exists(select 1 from public.speaker_queue o where o."sessionId"=sid and o.lane=queue_row.lane and o.state='active' and o.position<queue_row.position) then raise sqlstate 'PT409' using message='The speaker queue changed. Only the first speaker in the current queue can be recognized.'; end if;
   update public.speaker_queue set state='completed' where id=queue_row.id;
  end if;
  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"createdAt","amendmentId") values(new_id,conf,cid,sid,did,rid,classification_value,client_time,amend_value);$q$,'apply_procedure anchor 4');
 definition:=pg_temp.patch_once(definition,
  $q$  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"yieldedFrom","createdAt") values(new_id,conf,cid,sid,did,sp."resolutionId",'Co-Submitter',sp.id,client_time);$q$,
  $q$  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"yieldedFrom","createdAt","amendmentId") values(new_id,conf,cid,sid,did,sp."resolutionId",'Co-Submitter',sp.id,client_time,sp."amendmentId");$q$,'apply_procedure anchor 5');
 definition:=pg_temp.patch_once(definition,
  $q$  if points_value is null or points_value not between 1 and 3 then raise exception 'Speech points must be 1–3' using errcode='22023'; end if;$q$,
  $q$  vals:=private.scoring_values(conf,cid,'speech');
  if points_value is null or not points_value=any(vals) then raise exception 'Choose a configured speech value' using errcode='22023'; end if;$q$,'apply_procedure anchor 6');
 definition:=pg_temp.patch_once(definition,
  $q$ when 'poiRecognize' then
  if sp.state<>'pois' or (sp."poiLimit" is not null and sp."poiCount">=sp."poiLimit") then raise exception 'Set or extend POIs first' using errcode='22023'; end if;
  if points_value is null or points_value not between 1 and 2 then raise exception 'POI points must be 1 or 2' using errcode='22023'; end if;
  delete from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id returning "delegateId" into did;
  if did is null or not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=did and status<>'Absent') then raise exception 'POI delegate is unavailable' using errcode='22023'; end if;
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,did,sid,sp."resolutionId",'poi',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
  update public.speeches set "poiCount"="poiCount"+1,revision=revision+1 where id=sp.id;$q$,
  $q$ when 'poiRecognize' then
  if sp.state<>'pois' or (sp."poiLimit" is not null and sp."poiCount">=sp."poiLimit") then raise exception 'Set or extend POIs first' using errcode='22023'; end if;
  if exists(select 1 from public.poi_queue where "speechId"=sp.id and "recognizedAt" is not null) then raise exception 'Score or withdraw the current POI first' using errcode='22023'; end if;
  if command ? 'points' then
   -- Legacy one-step recognition saved by an older client: recognize and score together, exactly once.
   vals:=private.scoring_values(conf,cid,'poi');
   if points_value is null or not points_value=any(vals) then raise exception 'Choose a configured POI value' using errcode='22023'; end if;
   delete from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id returning "delegateId" into did;
   if did is null or not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=did and status<>'Absent') then raise exception 'POI delegate is unavailable' using errcode='22023'; end if;
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,did,sid,sp."resolutionId",'poi',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
   update public.speeches set "poiCount"="poiCount"+1,revision=revision+1 where id=sp.id;
  else
   -- Recognition only gives the floor to the first raised placard. It records no participation points.
   select * into poi_row from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id;
   if not found or exists(select 1 from public.poi_queue o where o."speechId"=sp.id and o.position<poi_row.position) then raise sqlstate 'PT409' using message='The POI queue changed. Only the first POI can be recognized.'; end if;
   if not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=poi_row."delegateId" and status<>'Absent') then raise exception 'POI delegate is unavailable' using errcode='22023'; end if;
   update public.poi_queue set "recognizedAt"=client_time where id=poi_row.id;
   update public.speeches set revision=revision+1 where id=sp.id;
  end if;
 when 'poiScore' then
  select * into poi_row from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id;
  if not found or poi_row."recognizedAt" is null then raise exception 'Recognize this POI before scoring it' using errcode='22023'; end if;
  vals:=private.scoring_values(conf,cid,'poi');
  if points_value is null or not points_value=any(vals) then raise exception 'Choose a configured POI value' using errcode='22023'; end if;
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,poi_row."delegateId",sid,sp."resolutionId",'poi',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
  delete from public.poi_queue where id=poi_row.id;
  update public.speeches set "poiCount"="poiCount"+1,revision=revision+1 where id=sp.id;
 when 'poiRemove' then
  delete from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id;
  if not found then raise sqlstate 'PT409' using message='POI queue changed'; end if;
  update public.speeches set revision=revision+1 where id=sp.id;$q$,'apply_procedure anchor 7');
 execute definition;
end $patch$;

-- 6) private.apply_staff_batch: an amendment debate starts, and an active amendment closes (Pass/Fail/
--    Withdraw/Rule Out), only while no speech or POI holds the floor in its session or the current session.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('private.apply_staff_batch(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 definition:=pg_temp.patch_once(definition,
  $q$  if target='In Debate' and exists(select 1 from public.amendments where committee_id=cid and status='In Debate' and id<>amend.id) then raise exception 'Close the current amendment debate first' using errcode='22023';end if;$q$,
  $q$  if target='In Debate' and exists(select 1 from public.amendments where committee_id=cid and status='In Debate' and id<>amend.id) then raise exception 'Close the current amendment debate first' using errcode='22023';end if;
  -- Procedural invariant: start an amendment debate, or close an active one, only with the floor at the Chair.
  if (target='In Debate' or (amend.status='In Debate' and target='Closed')) and exists(select 1 from public.speeches where committee_id=cid and conference_id=conf and state<>'finished' and "sessionId" in (amend."sessionId",committee."currentSessionId")) then raise exception 'Finish the current speech and return the floor to the Chair first.' using errcode='22023';end if;$q$,'apply_staff_batch anchor 1');
 execute definition;
end $patch$;

-- 7) Route the two new procedure commands.
create or replace function public.apply_conference_mutation(conf uuid,mutation uuid,command jsonb,requested_role public.conference_role,expected text,client_time timestamptz)
returns void language plpgsql security invoker set search_path='' as $$ begin
 if command->>'type' in ('committeeUpdate','committeeLifecycle','sessionSlot','amendmentLink','amendmentStatus') then
  perform private.apply_staff_batch(conf,mutation,command,requested_role,expected,client_time);
 elsif command->>'type' in ('currentSession','debateMode','queueAdd','queueOrder','queueRemove','speechStart','speechYield','speechScore','speechFinish','poiAllowance','poiAdd','poiOrder','poiRecognize','poiScore','poiRemove','voteMode','vetoRules') then
  perform private.apply_procedure(conf,mutation,command,requested_role,expected,client_time);
 else perform private.apply_mutation(conf,mutation,command,requested_role,expected,client_time);end if;
end $$;
