-- Executive read projection only. Existing snapshots, RLS and append-only history are unchanged.
-- Select the newest 50 audit records, then return them chronologically as the UI expects.
-- The existing audit_history(conference_id, "createdAt" DESC) index bounds this lookup.
create function public.executive_snapshot(conf uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.conferences where id=conf) then
  raise exception 'Conference access has not been granted' using errcode='42501';
 end if;
 return jsonb_build_object(
 'conference',(select jsonb_build_object('id',id,'name',name,'venue',venue,'date',date,'features',features,'votingRule',voting_rule) from public.conferences where id=conf),
 'committees',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('conferenceId',conference_id,'votingRule',voting_rule,'scoringOverrides',(select jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values)) from public.scoring_definitions s where s.committee_id=x.id)) order by x.created_at,x.id),'[]') from public.committees x where conference_id=conf),
 'schools',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.schools x where conference_id=conf),
 'staff',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('role',coalesce((select role::text from public.conference_staff f where f.staff_id=x.id limit 1),'chair'),'committeeIds',(select coalesce(jsonb_agg(committee_id),'[]') from public.committee_staff a where a.staff_id=x.id)) order by x.created_at,x.id),'[]') from public.staff x where conference_id=conf),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.sessions x where conference_id=conf),
 'delegates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.delegates x where conference_id=conf),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.attendance x where conference_id=conf),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id,'versionIds',(select coalesce(jsonb_agg(v.id order by number),'[]') from public.document_versions v where v."documentId"=x.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'authorId',"authorId",'createdAt',"createdAt") order by "createdAt"),'[]') from public.document_comments c where c."documentId"=x.id)) order by x.created_at,x.id),'[]') from public.documents x where conference_id=conf),
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
 'timers','{}'::jsonb
 );
end; $$;
revoke all on function public.executive_snapshot(uuid) from public,anon;
grant execute on function public.executive_snapshot(uuid) to authenticated;
