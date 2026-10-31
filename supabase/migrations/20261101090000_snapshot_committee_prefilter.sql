-- Snapshot read cost: skip other committees' rows before the per-row access check (docs/LOAD_RUN_SHEET_2026-10-31.md, section 8).
-- PROTECTED change (a read function every staff device calls; unapplied; needs independent review). Read-only: no table, policy or
-- grant on any table changes, and nothing is written.
--
-- Measured on the 31 October load window: the snapshot reads were about 99 % of database time. public.conference_snapshot reads under
-- RLS, and each table's read policy calls private.has_access(conference_id, committee_id, roles) once PER ROW. The function selects every
-- row of the conference, so a committee-scoped Chair paid a has_access call for every other committee's row only for RLS to reject it.
-- A local replay of fixture B after H3 (19 committees, 420 delegates, 121 roll calls) counted 2,834 such calls for one Chair snapshot.
--
-- private.visible_committees(conf, roles) returns, once per call, the committees whose rows the caller can see for a policy of that
-- shape: NULL (no filter) for a conference-wide grant with one of the roles or for no signed-in user (owner and server callers, which
-- RLS does not restrict here); otherwise the committees of the caller's live grants with one of the roles, possibly none. Each table
-- scan in conference_snapshot adds `committee_id is null or committee_id = any(<that set>)`, using the role list of that table's read
-- policy. The predicate is leakproof, so PostgreSQL applies it before the policy and the policy only runs on rows it could accept.
-- RLS still decides visibility: this can only skip rows the policy would reject, so the output is unchanged for every caller
-- (tests/snapshot-prefilter-db.test.ts compares it role by role). The same replay: a single-committee Chair 2,834 -> 453 policy calls,
-- about 79 -> 28 ms; Approval 2,641 -> 524, about 76 -> 25 ms; conference-wide callers unchanged.
--
-- The rewritten function is GENERATED from the definition in force after 20261031100000 with exact-text edits only.

create function private.visible_committees(conf uuid, roles public.conference_role[]) returns uuid[]
language sql stable security definer set search_path='' as $$
  select case
    when (select auth.uid()) is null then null
    when exists (select 1 from public.user_access a where a.user_id=(select auth.uid()) and a.conference_id=conf and a.revoked_at is null
                   and a.expires_at>now() and a.role=any(roles) and private.lifecycle_allows(a.test_only) and a.committee_id is null) then null
    else coalesce((select array_agg(distinct a.committee_id) from public.user_access a where a.user_id=(select auth.uid()) and a.conference_id=conf
                   and a.revoked_at is null and a.expires_at>now() and a.role=any(roles) and private.lifecycle_allows(a.test_only)), '{}'::uuid[])
  end
$$;
revoke all on function private.visible_committees(uuid, public.conference_role[]) from public, anon, service_role;
grant execute on function private.visible_committees(uuid, public.conference_role[]) to authenticated;

CREATE OR REPLACE FUNCTION public.conference_snapshot(conf uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; countries jsonb;
 v_all uuid[] := private.visible_committees(conf, array['admin','chair','approval','logistics','observer']::public.conference_role[]);
 v_aco uuid[] := private.visible_committees(conf, array['admin','chair','observer']::public.conference_role[]);
 v_adm uuid[] := private.visible_committees(conf, array['admin']::public.conference_role[]);
begin
 if not exists(select 1 from public.conferences where id=conf) then raise exception 'Conference access has not been granted' using errcode='42501'; end if;
 countries:=private.document_submitter_countries(conf);
 select jsonb_build_object(
 'conference',(select jsonb_build_object('id',id,'name',name,'venue',venue,'date',date,'features',features,'votingRule',voting_rule) from public.conferences where id=conf),
 'committees',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('conferenceId',conference_id,'votingRule',voting_rule,'scoringOverrides',(select jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values)) from public.scoring_definitions s where s.committee_id=x.id)) order by x.created_at,x.id),'[]') from public.committees x where conference_id=conf and (v_all is null or x.id is null or x.id=any(v_all))),
 'schools',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.schools x where conference_id=conf),
 'staff',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('role',coalesce((select role::text from public.conference_staff f where f.staff_id=x.id limit 1),'chair'),'committeeIds',(select coalesce(jsonb_agg(committee_id),'[]') from public.committee_staff a where a.staff_id=x.id)) order by x.created_at,x.id),'[]') from public.staff x where conference_id=conf),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.sessions x where conference_id=conf and (v_all is null or x.committee_id is null or x.committee_id=any(v_all))),
 'delegates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.delegates x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.attendance x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id,'submitterCountry',countries->>x.id::text,'versionIds',(select coalesce(jsonb_agg(v.id order by number),'[]') from public.document_versions v where v."documentId"=x.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'authorId',"authorId",'createdAt',"createdAt") order by "createdAt"),'[]') from public.document_comments c where c."documentId"=x.id)) order by x.created_at,x.id),'[]') from public.documents x where conference_id=conf and (v_all is null or x.committee_id is null or x.committee_id=any(v_all))),
 'versions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.document_versions x where conference_id=conf and (v_all is null or x.committee_id is null or x.committee_id=any(v_all))),
 'events',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',x.committee_id,'speechId',(select e."speechId" from public.participation_events e where e.id=x.id),'classification',(select e.classification from public.participation_events e where e.id=x.id),'yieldedFrom',(select e."yieldedFrom" from public.participation_events e where e.id=x.id),'points',effective_points,'voidedAt',voided_at,'updatedAt',corrected_at,'revision',(select count(*) from public.participation_corrections c where c.event_id=x.id)) order by x.created_at,x.id),'[]') from public.participation_history x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'queue',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.speaker_queue x where conference_id=conf and state='active' and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'votes',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.votes x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'scoring',(select coalesce(jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values) order by x.created_at,x.id),'[]') from public.scoring_definitions x where conference_id=conf and committee_id is null),
 'criteria',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.award_criteria x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'awardScores',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.award_scores x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.audit_log x where conference_id=conf and (v_adm is null or x.committee_id is null or x.committee_id=any(v_adm))),
 'timers','{}'::jsonb
 ) into result;
 return result || jsonb_build_object(
 'debateStates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'id' || jsonb_build_object('committeeId',committee_id)),'[]') from public.debate_states x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'speeches',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id' || jsonb_build_object('committeeId',committee_id)),'[]') from public.speeches x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))),
 'rollCalls',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'committeeId',r.committee_id,'copiedFrom',r.copied_from,'observedAt',r.observed_at,'committedAt',r.local_committed_at,'effectiveAt',r.effective_at,'timeConfidence',r.time_confidence,'legacy',r.legacy,'rows',(select coalesce(jsonb_agg(jsonb_build_object('delegateId',x.delegate_id,'status',x.status) order by x.delegate_id),'[]') from public.roll_call_row x where x.roll_call_id=r.id and x.revision=r.revision)) order by r.effective_at,r.id,r.revision),'[]') from public.roll_call r where r.conference_id=conf and r.state='committed' and (v_aco is null or r.committee_id is null or r.committee_id=any(v_aco))),
 'ballots',(select coalesce(jsonb_agg(jsonb_build_object('resolutionId',b.resolution_id,'delegateId',b.delegate_id,'status',b.status,'committeeId',b.committee_id) order by b.resolution_id,b.delegate_id),'[]') from public.ballot_eligibility b where b.conference_id=conf and (v_aco is null or b.committee_id is null or b.committee_id=any(v_aco))),
 'poiQueue',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'),'[]') from public.poi_queue x where conference_id=conf and (v_aco is null or x.committee_id is null or x.committee_id=any(v_aco))));
end; $function$

;
