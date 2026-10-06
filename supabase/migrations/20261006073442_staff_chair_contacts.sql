-- Staff directory contacts are not login identities. Publish only assigned Chair contacts
-- through the server-only, token-scoped submission lookup. Existing RLS stays unchanged.
alter table public.staff add column email text,
  add column "contactRevision" integer not null default 1,
  add constraint staff_contact_email check(email is null or (length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
create or replace function private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); kind text:=command->>'type'; cid uuid; sid uuid; did uuid;
 rid uuid; entity uuid; rec public.documents; att public.attendance; ev public.participation_events;
 prior private.mutation_receipts; actual text; vals integer[]; target text:=command->>'status';
 new_id uuid:=(substr(mutation::text,1,24)||'000000000001')::uuid;
 second_id uuid:=(substr(mutation::text,1,24)||'000000000002')::uuid;
 payload jsonb:=jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
 n integer; yes_votes integer; no_votes integer; rule text; result public.document_outcome;
 row_data jsonb; category text; topic text:='chair';
begin
 if actor is null then raise exception 'Session required' using errcode='42501'; end if;
 if pg_column_size(command)>1048576 then raise exception 'Command too large' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
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
   if not found then raise exception 'Event unavailable' using errcode='42501'; end if;
   cid:=ev.committee_id; sid:=ev."sessionId";
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
 if kind in ('attendance','participation','event','queue','timer','vote','newDocument','version','award') and requested_role<>'chair' then raise exception 'Chair access required' using errcode='42501'; end if;
 if kind not in ('attendance','participation','event','queue','timer','vote','newDocument','version','award','document') and requested_role<>'admin' then raise exception 'Administrator access required' using errcode='42501'; end if;
 -- A committee's short transactions serialize queue, attendance and voting boundaries.
 -- Independent committees use different row locks; no conference-wide chair lock.
 if cid is not null then perform 1 from public.committees where id=cid and conference_id=conf for update;
 else perform 1 from public.conferences where id=conf for update; end if;
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
 elsif kind='attendance' then select * into att from public.attendance where "sessionId"=sid and "delegateId"=did; actual:=coalesce(att.revision,0)::text;
 elsif kind='event' then select count(*)::text into actual from public.participation_corrections where event_id=ev.id;
 elsif kind='timer' then select coalesce((select revision from public.timers where "sessionId"=sid),0)::text into actual;
 elsif kind='vote' then select coalesce((select revision from public.votes where "sessionId"=sid and "delegateId"=did and "resolutionId"=rid),0)::text into actual;
 elsif kind='queue' and coalesce((command->>'advance')::boolean,false) then select coalesce((select id::text from public.speaker_queue where "sessionId"=sid and state='active' order by position limit 1),'empty') into actual;
 end if;
 if actual is not null and actual is distinct from expected then raise exception 'Another chair updated this item. Review before applying your change.' using errcode='40001'; end if;
 case kind
 when 'attendance' then
   insert into public.attendance(id,conference_id,committee_id,"sessionId","delegateId",status)
   values(new_id,conf,cid,sid,did,target::public.attendance_state)
   on conflict("sessionId","delegateId") do update set status=excluded.status,"updatedAt"=now(),revision=attendance.revision+1,updated_at=now();
   -- A closed vote is historical. Subsequent roll call must not rewrite it.
   delete from public.votes v using public.documents d where v."resolutionId"=d.id and d.status<>'Closed' and v."sessionId"=sid and v."delegateId"=did and (target='Absent' or (target='Present & Voting' and v.choice='Abstain'));
   if target='Absent' then update public.speaker_queue set state='removed',updated_at=now() where "sessionId"=sid and "delegateId"=did and state='active'; end if;
 when 'participation' then
   category:=command->>'categoryId';
   if category='submitter' and (rid is null or (select "submitterId" from public.documents where id=rid) is distinct from did or exists(select 1 from public.participation_events where "resolutionId"=rid and "categoryId"='submitter')) then raise exception 'Main Submitter credit already recorded or resolution missing' using errcode='22023'; end if;
   select values into vals from public.scoring_definitions where conference_id=conf and code=category and (committee_id=cid or committee_id is null) order by committee_id nulls last limit 1;
   if vals is null or not (command->>'points')::integer=any(vals) then raise exception 'Invalid scoring value' using errcode='22023'; end if;
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt")
   values(new_id,conf,cid,did,sid,rid,category,(command->>'points')::integer,actor,client_time);
 when 'event' then
   select values into vals from public.scoring_definitions where conference_id=conf and code=ev."categoryId" and (committee_id=cid or committee_id is null) order by committee_id nulls last limit 1;
   if not coalesce((command->>'undo')::boolean,false) and (vals is null or not (command->>'points')::integer=any(vals)) then raise exception 'Invalid scoring value' using errcode='22023'; end if;
   insert into public.participation_corrections(id,conference_id,committee_id,event_id,points,voided,actor_id)
   values(new_id,conf,cid,ev.id,(command->>'points')::integer,coalesce((command->>'undo')::boolean,false),actor);
 when 'queue' then
   if coalesce((command->>'advance')::boolean,false) then
     update public.speaker_queue set state='completed',updated_at=now() where id=nullif(actual,'empty')::uuid;
     insert into public.timers(conference_id,committee_id,"sessionId",duration,remaining,"startedAt") values(conf,cid,sid,90,90,null)
     on conflict("sessionId") do update set remaining=timers.duration,"startedAt"=null,revision=timers.revision+1,updated_at=now();
   else
     if not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=did and status<>'Absent') then raise exception 'Delegate must be present' using errcode='22023'; end if;
     insert into public.speaker_queue(id,conference_id,committee_id,"sessionId","delegateId") values(new_id,conf,cid,sid,did) on conflict do nothing;
   end if;
 when 'timer' then
   insert into public.timers(id,conference_id,committee_id,"sessionId",duration,remaining,"startedAt") values(new_id,conf,cid,sid,(command->>'duration')::integer,(command->>'remaining')::numeric,(command->>'startedAt')::bigint)
   on conflict("sessionId") do update set duration=excluded.duration,remaining=excluded.remaining,"startedAt"=excluded."startedAt",revision=timers.revision+1,updated_at=now();
 when 'vote' then
   if exists(select 1 from public.documents where id=rid and ("sessionId" is distinct from sid or ("voteMode"='divide' and command->>'choice'='Abstain'))) then raise exception 'Vote session or mode does not permit this ballot' using errcode='22023'; end if;
   if not exists(select 1 from public.documents where id=rid and status='In Debate') then raise exception 'Voting requires active debate' using errcode='22023'; end if;
   if not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=did and status<>'Absent' and (status<>'Present & Voting' or command->>'choice'<>'Abstain')) then raise exception 'Attendance does not permit vote' using errcode='22023'; end if;
   insert into public.votes(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",choice) values(new_id,conf,cid,sid,did,rid,command->>'choice')
   on conflict("delegateId","sessionId","resolutionId") do update set choice=excluded.choice,revision=votes.revision+1,"createdAt"=now(),updated_at=now();
 when 'document' then
   topic:='documents';
   if not ((requested_role='chair' and ((rec.status='Draft' and target='Submitted') or (rec.status='Printed' and target='In Debate') or (rec.status='In Debate' and target='Closed')))
     or (requested_role='approval' and rec.status in ('Submitted','Review') and target in ('Review','Approved','Draft') and rec.status::text<>target)
     or (requested_role='logistics' and rec.status='Approved' and target='Printed')) then raise exception 'Transition not allowed for this role' using errcode='22023'; end if;
   if target='Draft' and length(trim(coalesce(command->>'comment','')))=0 then raise exception 'A change request requires a comment' using errcode='22023'; end if;
   if target='In Debate' and (select "currentSessionId" from public.committees where id=cid) is null then raise exception 'Select the current session first' using errcode='22023'; end if;
   if target='Closed' then
     if command->>'outcome'='Withdrawn' then result:='Withdrawn';
     else
       select count(*) into n from public.attendance where "sessionId"=sid and status<>'Absent';
       if n=0 or n<>(select count(*) from public.votes where "resolutionId"=rid and "sessionId"=sid) then raise exception 'Record every eligible ballot before closing' using errcode='22023'; end if;
       select count(*) filter(where choice='For'),count(*) filter(where choice='Against') into yes_votes,no_votes from public.votes where "resolutionId"=rid and "sessionId"=sid;
       select coalesce(c.voting_rule,f.voting_rule) into rule from public.committees c join public.conferences f on f.id=c.conference_id where c.id=cid;
       result:=case when yes_votes+no_votes>0 and ((rule='simple_majority' and yes_votes>no_votes) or (rule='two_thirds' and yes_votes*3>=(yes_votes+no_votes)*2)) then 'Passed'::public.document_outcome else 'Failed'::public.document_outcome end;
       if cardinality(private.veto_delegates(rid))>0 then result:='Failed'; end if;
       if command->>'outcome' is distinct from result::text then raise exception 'Outcome differs from configured voting rule' using errcode='22023'; end if;
     end if;
   end if;
   update public.documents set "vetoedBy"=case when target='Closed' and result<>'Withdrawn' then private.veto_delegates(rid) else "vetoedBy" end,
    "sessionId"=case when target='In Debate' then (select "currentSessionId" from public.committees where id=cid) else "sessionId" end,
    status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;
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
   insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) select new_id,conf,cid,sid,(command->>'submitterId')::uuid,c.code||' / '||substr(new_id::text,1,8),command->>'title' from public.committees c where c.id=cid;
   insert into public.document_versions(id,conference_id,committee_id,"documentId",number,"createdBy","fileName",text) values(second_id,conf,cid,new_id,1,actor,'draft-preview.txt',command->>'title');
 when 'award' then raise exception 'Award rubrics retired' using errcode='22023';
 when 'committee' then
   topic:='configuration'; insert into public.committees(id,conference_id,code,name,room) values(new_id,conf,trim(command->>'code'),command->>'name',command->>'room');
 when 'session' then
   topic:='configuration'; insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values(new_id,conf,cid,command->>'name',now(),'scheduled');
 when 'school' then
   topic:='configuration'; insert into public.schools(id,conference_id,name) values(new_id,conf,command->>'name');
 when 'delegate' then
   topic:='configuration'; update public.delegates set name=command->>'name',email=lower(command->>'email'),country=command->>'country',updated_at=now() where id=did and conference_id=conf;
 when 'import' then
   topic:='configuration'; n:=0;
   for row_data in select * from jsonb_array_elements(command->'rows') loop
     n:=n+1;
     if length(trim(row_data->>'name'))=0 or length(trim(row_data->>'country'))=0 or row_data->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid imported delegate' using errcode='22023'; end if;
     insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email) values((substr(mutation::text,1,24)||lpad(to_hex(n),12,'0'))::uuid,conf,(row_data->>'committeeId')::uuid,(row_data->>'schoolId')::uuid,row_data->>'country',row_data->>'name',lower(row_data->>'email'));
   end loop;
 when 'conference' then
   topic:='configuration'; update public.conferences set name=command->>'name',venue=command->>'venue',date=(command->>'date')::date,updated_at=now() where id=conf;
 when 'feature' then
   topic:='configuration'; update public.conferences set features=jsonb_set(features,array[command->>'name'],command->'enabled'),updated_at=now() where id=conf;
 when 'scoring' then
   topic:='configuration'; select array_agg(value::integer) into vals from jsonb_array_elements_text(command->'values');
   insert into public.scoring_definitions(conference_id,committee_id,code,label,values) select conf,cid,command->>'id',label,vals from public.scoring_definitions where conference_id=conf and committee_id is null and code=command->>'id'
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
 -- The timer has no Realtime event: countdown and start/pause/reset remain local calculations.
 if kind<>'timer' then insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,topic,mutation); end if;
end; $$;
revoke all on function private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) from public,anon;
grant execute on function private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;
create or replace function public.submission_link_info(link_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'linkId',l.id,'conferenceId',l.conference_id,'committeeId',l.committee_id,
  'conferenceName',f.name,'committeeCode',c.code,'committeeName',c.name,'shareWith','',
  'chairs',(select coalesce(jsonb_agg(jsonb_build_object('name',s.name,'email',s.email) order by s.name,s.id),'[]')
    from public.staff s join public.committee_staff a on a.staff_id=s.id and a.conference_id=s.conference_id
    where a.committee_id=l.committee_id and s.conference_id=l.conference_id and s.email is not null
      and exists(select 1 from public.conference_staff r where r.staff_id=s.id and r.conference_id=l.conference_id and r.role='chair')),
  'submitters',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'country',d.country,'flag',d.flag) order by d.country),'[]') from public.delegates d where d.committee_id=l.committee_id and d.conference_id=l.conference_id))
 from public.submission_links l join public.committees c on c.id=l.committee_id join public.conferences f on f.id=l.conference_id
 where l.token=link_token and l.revoked_at is null;
$$;
revoke all on function public.submission_link_info(text) from public,anon,authenticated;
grant execute on function public.submission_link_info(text) to service_role;
comment on column public.submission_links.share_with is 'Deprecated compatibility field. Human Chair contacts derive from staff assignments; never an automation identity.';
