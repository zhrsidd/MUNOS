-- Non-destructive remote smoke test. All fixture users and grants are rolled back.
begin;
insert into auth.users(id) values('eeeeeeee-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','eeeeeeee-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.conferences) then raise exception 'FAIL: ungranted user can read conference'; end if;
 begin perform public.conference_snapshot('10000000-0000-4000-8000-000000000001');raise exception 'FAIL: unauthorized snapshot';exception when insufficient_privilege then null;end;
 begin insert into public.schools(conference_id,name)values('10000000-0000-4000-8000-000000000001','Forbidden');raise exception 'FAIL: direct DML allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into public.user_access(conference_id,user_id,role,committee_id,expires_at)
select conference_id,'eeeeeeee-0000-4000-8000-000000000001','chair',id,now()+interval '10 minutes' from public.committees where code='GA1' and conference_id='10000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare cid uuid; sid uuid; did uuid; before_count integer; m uuid:=gen_random_uuid(); c jsonb; begin
 if (select count(*) from public.committees)<>1 then raise exception 'FAIL: committee isolation';end if;
 if (select count(*) from public.delegates)<>12 then raise exception 'FAIL: delegate scope';end if;
 select id into cid from public.committees limit 1;
 select id into sid from public.sessions where committee_id=cid limit 1;
 select id into did from public.delegates where name='Mohammad Maaz';
 c:=jsonb_build_object('type','participation','delegateId',did,'sessionId',sid,'categoryId','speech','points',2,'resolutionId',null);
 select count(*) into before_count from public.participation_events;
 perform public.apply_conference_mutation('10000000-0000-4000-8000-000000000001',m,c,'chair',null,'2026-10-05T11:00:00Z');
 perform public.apply_conference_mutation('10000000-0000-4000-8000-000000000001',m,c,'chair',null,'2026-10-05T11:00:00Z');
 if (select count(*) from public.participation_events)<>before_count+1 then raise exception 'FAIL: duplicate retry';end if;
 begin perform public.apply_conference_mutation('10000000-0000-4000-8000-000000000001',gen_random_uuid(),'{"type":"conference","name":"Bad","venue":"Bad","date":"2026-10-05"}','admin',null,now());raise exception 'FAIL: role escalation';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
