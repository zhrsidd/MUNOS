-- Configurable points (docs/plans/PROTECTED_FEATURES_PLAN.md §3).
-- Main Submitter becomes one configurable value (1–20, default +5), still credited once per resolution on the
-- Main Submitter's first scored speech. Debated amendment becomes a required configurable category (default 3);
-- awarding it stays manual. Mirrors lib/scoring.ts.
-- Function changes only: no table, policy or grant changes. Stored participation events keep their points.
-- private.apply_procedure is PATCHED in place with an exact anchor, like 20261009120000. Fail closed.

-- 1) Required categories and their built-in defaults.
create or replace function private.required_scoring_label(category text) returns text language sql immutable set search_path='' as $$
 select case category when 'speech' then 'Speech' when 'poi' then 'POI' when 'submitter' then 'Main Submitter' when 'amendment' then 'Debated amendment' end $$;
create or replace function private.scoring_values(conf uuid,cid uuid,category text) returns integer[] language sql stable set search_path='' as $$
 select coalesce(
  (select s.values from public.scoring_definitions s where s.conference_id=conf and s.code=category and (s.committee_id=cid or s.committee_id is null) order by s.committee_id nulls last limit 1),
  case category when 'speech' then array[1,2,3] when 'poi' then array[1,2] when 'submitter' then array[5] when 'amendment' then array[3] end) $$;
-- Main Submitter is a single credit, so it takes exactly one value from 1 to 20.
create or replace function private.scoring_problem(category text,vals integer[]) returns text language sql immutable set search_path='' as $$
 select case
  when category='submitter' then case when vals is null or cardinality(vals)<>1 or vals[1] is null or vals[1] not between 1 and 20 then 'Main Submitter credit is one whole number from 1 to 20.' end
  when vals is null or cardinality(vals) not between 1 and 10 or exists(select 1 from unnest(vals) v where v is null or v<0 or v>20) then 'Use 1–10 whole-number points from 0 to 20.'
  when cardinality(vals)<>(select count(distinct v) from unnest(vals) v) then 'Each point value may appear only once.'
 end $$;
revoke all on function private.required_scoring_label(text) from public,anon,authenticated;
revoke all on function private.scoring_values(uuid,uuid,text) from public,anon,authenticated;
revoke all on function private.scoring_problem(text,integer[]) from public,anon,authenticated;

-- Replace exactly one occurrence of an anchor or stop the migration.
create or replace function pg_temp.patch_once(definition text,anchor text,replacement text,label text) returns text language plpgsql as $$
begin
 if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception '% changed; review before applying',label; end if;
 return replace(definition,anchor,replacement);
end $$;

-- 2) private.apply_procedure: the automatic Main Submitter credit uses the committee's configured value. A speech
--    score carries the credit the saving device awarded ("submitterPoints"; absent on actions saved before this
--    migration, which always awarded +5). When the credit is due and that value is not the current setting, the
--    action is refused as a stale write (PT409, a retained conflict on the device), never repriced. Mirrors
--    lib/procedure/commands.ts. When no credit is due (already recorded), the carried value is not consulted.
do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 definition:=pg_temp.patch_once(definition,
  $q$  if sp.classification='Main Submitter' and not exists(select 1 from public.participation_events where "resolutionId"=sp."resolutionId" and "categoryId"='submitter') then
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification) values(second_id,conf,cid,sp."delegateId",sid,sp."resolutionId",'submitter',5,actor,client_time,sp.id,sp.classification);$q$,
  $q$  if sp.classification='Main Submitter' and not exists(select 1 from public.participation_events where "resolutionId"=sp."resolutionId" and "categoryId"='submitter') then
   vals:=private.scoring_values(conf,cid,'submitter');
   if coalesce(command->'submitterPoints','5'::jsonb) is distinct from to_jsonb(vals[1]) then raise sqlstate 'PT409' using message='The Main Submitter points changed. Review the Debate Console.'; end if;
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification) values(second_id,conf,cid,sp."delegateId",sid,sp."resolutionId",'submitter',vals[1],actor,client_time,sp.id,sp.classification);$q$,'apply_procedure submitter credit');
 execute definition;
end $patch$;
