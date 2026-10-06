-- Replace only explicitly raised MUNOS business conflicts captured from current
-- development pg_get_functiondef output. Keep locks, authorization and receipts intact.

-- private.apply_mutation: 1 business conflict signal(s).
CREATE OR REPLACE FUNCTION private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if actual is not null and actual is distinct from expected then raise sqlstate 'PT409' using message='Another chair updated this item. Review before applying your change.'; end if;
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
end; $function$
;

-- private.apply_operations_mutation: 1 business conflict signal(s).
CREATE OR REPLACE FUNCTION private.apply_operations_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 actor uuid := auth.uid(); kind text := command->>'type'; cid uuid; entity uuid; affected uuid[] := '{}'; c uuid; topic text := 'configuration';
 allowed public.conference_role[] := array['admin']::public.conference_role[];
 prior private.mutation_receipts; actual text;
 new_id uuid := (substr(mutation::text,1,24)||'000000000001')::uuid;
 payload jsonb := jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
begin
 if actor is null then raise exception 'Session required' using errcode='42501'; end if;
 if pg_column_size(command) > 262144 then raise exception 'Command too large' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 select * into prior from private.mutation_receipts where id = mutation;
 if found then
   if prior.actor_id <> actor or prior.conference_id <> conf or prior.payload <> payload then raise exception 'Idempotency key reused for a different action' using errcode='22023'; end if;
   return;
 end if;
 case kind
 when 'submissionLink', 'photoAck' then
   cid := private.uuid_or_null(command->>'committeeId');
   if cid is null or not exists(select 1 from public.committees where id = cid and conference_id = conf) then raise exception 'Committee unavailable' using errcode='22023'; end if;
   if kind = 'photoAck' then allowed := array['chair']::public.conference_role[]; topic := 'chair'; end if;
 when 'resolutionLink' then
   select committee_id into cid from public.documents where id = private.uuid_or_null(command->>'documentId') and conference_id = conf;
   if cid is null then raise exception 'Document unavailable' using errcode='42501'; end if;
   allowed := array['chair','admin']::public.conference_role[]; topic := 'documents';
 when 'sessionImport', 'photoSlot', 'photoImport' then cid := null;
 else raise exception 'Unknown operations command' using errcode='22023';
 end case;
 if not requested_role = any(allowed) then raise exception '% access required', case when 'chair' = any(allowed) then 'Chair' else 'Executive' end using errcode='42501'; end if;
 if not private.has_access(conf, cid, array[requested_role]) then raise exception 'This session has no access to this role or committee' using errcode='42501'; end if;
 if cid is not null then perform 1 from public.committees where id = cid and conference_id = conf for update;
 else perform 1 from public.conferences where id = conf for update; end if;
 -- Compare under the same lock as the write. A missing precondition is not permission to overwrite.
 if kind = 'resolutionLink' then
   select revision::text into actual from public.resolution_links where document_id = private.uuid_or_null(command->>'documentId');
   actual := coalesce(actual,'0');
 elsif kind = 'photoSlot' and command->>'action' = 'update' then
   select revision::text into actual from public.photo_slots where id = private.uuid_or_null(command->>'slotId') and conference_id = conf;
   actual := coalesce(actual,'0');
 elsif kind = 'submissionLink' then
   select id::text || '|' || share_with into actual from public.submission_links where committee_id = cid and revoked_at is null;
   actual := coalesce(actual,'none');
 end if;
 if actual is not null and expected is distinct from actual then
   raise sqlstate 'PT409' using message='This item changed on another device. Review the saved change before retrying.';
 end if;
 case kind
 when 'submissionLink' then entity := private.ops_submission_link(conf, cid, actor, new_id, command);
 when 'resolutionLink' then entity := private.ops_resolution_link(conf, cid, command);
 when 'sessionImport' then affected := private.ops_session_import(conf, mutation, command);
 when 'photoSlot' then affected := private.ops_photo_slot(conf, new_id, command); entity := coalesce(private.uuid_or_null(command->>'slotId'), new_id);
 when 'photoImport' then affected := private.ops_photo_import(conf, mutation, command);
 when 'photoAck' then entity := private.ops_photo_ack(conf, cid, actor, command);
 end case;
 insert into public.audit_log(conference_id, committee_id, "actorId", action, "entityId", mutation_id, details)
 values (conf, cid, actor, kind || ' ' || coalesce(command->>'action', command->>'stage', 'updated'), coalesce(entity, cid, conf), mutation,
   case kind when 'submissionLink' then command - 'token' when 'sessionImport' then jsonb_build_object('type', kind, 'rows', jsonb_array_length(command->'rows'))
             when 'photoImport' then jsonb_build_object('type', kind, 'rows', jsonb_array_length(command->'rows')) else command end);
 insert into private.mutation_receipts(id, conference_id, actor_id, payload) values (mutation, conf, actor, payload);
 insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, cid, topic, mutation);
 -- Chairs subscribe per committee: notify each affected committee as well (one small row each).
 foreach c in array affected loop
   continue when c is not distinct from cid;
   insert into public.operational_changes(conference_id, committee_id, topic, mutation_id) values (conf, c, 'configuration', gen_random_uuid());
 end loop;
end; $function$
;

-- private.apply_procedure: 4 business conflict signal(s).
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
begin
 if actor is null then raise exception 'Session required' using errcode='42501'; end if;
 if pg_column_size(command)>262144 then raise exception 'Command too large' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 select * into prior from private.mutation_receipts where id=mutation;
 if found then
  if prior.actor_id<>actor or prior.conference_id<>conf or prior.payload<>payload then raise exception 'Idempotency key reused for a different action' using errcode='22023'; end if;
  return;
 end if;
 if kind='vetoRules' then cid:=private.uuid_or_null(command->>'committeeId');
 else select committee_id into cid from public.sessions where id=sid and conference_id=conf; end if;
 if cid is null or not exists(select 1 from public.committees where id=cid and conference_id=conf) then raise exception 'Committee unavailable' using errcode='42501'; end if;
 if requested_role<>(case when kind='vetoRules' then 'admin'::public.conference_role else 'chair'::public.conference_role end) or not private.has_access(conf,cid,array[requested_role]) then raise exception 'Access denied' using errcode='42501'; end if;
 perform 1 from public.committees where id=cid for update;
 if did is not null and not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=did and status<>'Absent') then raise exception 'Delegate must be present' using errcode='22023'; end if;
 if command ? 'speechId' then
  select * into sp from public.speeches where id=private.uuid_or_null(command->>'speechId') and "sessionId"=sid and conference_id=conf;
  if not found or sp.state='finished' then raise exception 'Speech has finished or is unavailable' using errcode='22023'; end if;
 end if;
 if kind='currentSession' then
  if cid is distinct from private.uuid_or_null(command->>'committeeId') then raise exception 'Session outside committee' using errcode='22023'; end if;
  select "sessionRevision"::text into actual from public.committees where id=cid;
 elsif kind='debateMode' then select coalesce((select revision from public.debate_states where "sessionId"=sid),0)::text into actual;
 elsif kind='queueOrder' then select coalesce(string_agg(id::text,',' order by position),'') into actual from public.speaker_queue where "sessionId"=sid and lane=lane_value and state='active';
 elsif kind='poiOrder' then select coalesce(string_agg(id::text,',' order by position),'') into actual from public.poi_queue where "speechId"=sp.id;
 elsif kind='speechStart' then select coalesce((select id::text from public.speeches where "sessionId"=sid and state<>'finished'),'empty') into actual;
 elsif kind in ('speechYield','speechFinish','poiAllowance','poiRecognize') then actual:=sp.revision::text;
 elsif kind='voteMode' then select revision::text into actual from public.documents where id=rid and committee_id=cid and conference_id=conf;
 end if;
 if actual is not null and actual is distinct from expected then raise sqlstate 'PT409' using message='Another Chair changed this item. Review before applying.'; end if;
 case kind
 when 'currentSession' then update public.committees set "currentSessionId"=sid,"sessionRevision"="sessionRevision"+1 where id=cid;
 when 'vetoRules' then
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(command->'delegateIds');
  if exists(select 1 from unnest(ids) x where not exists(select 1 from public.delegates d where d.id=x and d.committee_id=cid)) or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) then raise exception 'Invalid veto delegations' using errcode='22023'; end if;
  update public.committees set "vetoEnabled"=(command->>'enabled')::boolean,"vetoDelegateIds"=ids where id=cid;
 when 'debateMode' then
  insert into public.debate_states("sessionId",conference_id,committee_id,mode,phase) values(sid,conf,cid,command->>'mode',command->>'phase')
  on conflict("sessionId") do update set mode=excluded.mode,phase=excluded.phase,revision=debate_states.revision+1;
 when 'queueAdd' then
  select coalesce(max(position),-1)+1 into n from public.speaker_queue where "sessionId"=sid and lane=lane_value and state='active';
  insert into public.speaker_queue(id,conference_id,committee_id,"sessionId","delegateId",lane,position) values(new_id,conf,cid,sid,did,lane_value,n) on conflict do nothing;
 when 'queueRemove' then update public.speaker_queue set state='removed' where id=private.uuid_or_null(command->>'entryId') and "sessionId"=sid;
 when 'queueOrder' then
  select coalesce(array_agg(value::uuid),'{}') into ids from jsonb_array_elements_text(command->'ids');
  if cardinality(ids)<>(select count(*) from public.speaker_queue where "sessionId"=sid and lane=lane_value and state='active') or cardinality(ids)<>(select count(distinct x) from unnest(ids)x) or exists(select 1 from unnest(ids)x where not exists(select 1 from public.speaker_queue q where q.id=x and q."sessionId"=sid and q.lane=lane_value and q.state='active')) then raise sqlstate 'PT409' using message='Queue changed'; end if;
  update public.speaker_queue set position=array_position(ids,id)-1 where id=any(ids);
 when 'speechStart' then
  if exists(select 1 from public.speeches where "sessionId"=sid and state<>'finished') then raise exception 'Return the floor to Chair first' using errcode='22023'; end if;
  if rid is not null then
   select * into r from public.documents where id=rid and committee_id=cid and conference_id=conf and status='In Debate';
   if not found then raise exception 'Resolution must be in debate' using errcode='22023'; end if;
  end if;
  if classification_value='Co-Submitter' or (classification_value='Main Submitter' and (rid is null or r."submitterId" is distinct from did)) then raise exception 'Invalid speech relationship' using errcode='22023'; end if;
  if command ? 'entryId' then
   update public.speaker_queue set state='completed' where id=private.uuid_or_null(command->>'entryId') and "sessionId"=sid and "delegateId"=did and state='active';
   if not found then raise sqlstate 'PT409' using message='Queue entry changed'; end if;
  end if;
  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"createdAt") values(new_id,conf,cid,sid,did,rid,classification_value,client_time);
 when 'speechYield' then
  if sp.classification<>'Main Submitter' or sp."resolutionId" is null or did=sp."delegateId" then raise exception 'Only Main Submitter may yield to another delegate' using errcode='22023'; end if;
  update public.speeches set state='finished',revision=revision+1 where id=sp.id;
  delete from public.poi_queue where "speechId"=sp.id;
  insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"yieldedFrom","createdAt") values(new_id,conf,cid,sid,did,sp."resolutionId",'Co-Submitter',sp.id,client_time);
 when 'speechScore' then
  if points_value is null or points_value not between 1 and 3 then raise exception 'Speech points must be 1–3' using errcode='22023'; end if;
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,sp."delegateId",sid,sp."resolutionId",'speech',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
  if sp.classification='Main Submitter' and not exists(select 1 from public.participation_events where "resolutionId"=sp."resolutionId" and "categoryId"='submitter') then
   insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification) values(second_id,conf,cid,sp."delegateId",sid,sp."resolutionId",'submitter',5,actor,client_time,sp.id,sp.classification);
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
  if points_value is null or points_value not between 1 and 2 then raise exception 'POI points must be 1 or 2' using errcode='22023'; end if;
  delete from public.poi_queue where id=private.uuid_or_null(command->>'entryId') and "speechId"=sp.id returning "delegateId" into did;
  if did is null or not exists(select 1 from public.attendance where "sessionId"=sid and "delegateId"=did and status<>'Absent') then raise exception 'POI delegate is unavailable' using errcode='22023'; end if;
  insert into public.participation_events(id,conference_id,committee_id,"delegateId","sessionId","resolutionId","categoryId",points,"chairId","createdAt","speechId",classification,"yieldedFrom") values(new_id,conf,cid,did,sid,sp."resolutionId",'poi',points_value,actor,client_time,sp.id,sp.classification,sp."yieldedFrom");
  update public.speeches set "poiCount"="poiCount"+1,revision=revision+1 where id=sp.id;
 when 'voteMode' then
  if not exists(select 1 from public.documents where id=rid and committee_id=cid and status='In Debate') then raise exception 'Open a resolution for debate first' using errcode='22023'; end if;
  delete from public.votes where "resolutionId"=rid; -- Prior ballot choices remain in the immutable audit log.
  update public.documents set "voteMode"=command->>'mode',"voteType"=command->>'voteType',"sessionId"=sid,revision=revision+1 where id=rid;
 else raise exception 'Unknown procedural command' using errcode='22023';
 end case;
 if kind in ('speechStart','speechYield','speechFinish') then
  insert into public.timers(conference_id,committee_id,"sessionId",duration,remaining,"startedAt") values(conf,cid,sid,90,90,null)
  on conflict("sessionId") do update set remaining=timers.duration,"startedAt"=null,revision=timers.revision+1;
 end if;
 if kind not in ('queueAdd','queueOrder','queueRemove','poiAdd','poiOrder','poiAllowance','debateMode') then
  insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values(conf,cid,actor,kind,coalesce(sp.id,rid,did,cid),mutation,command);
 end if;
 insert into private.mutation_receipts(id,conference_id,actor_id,payload) values(mutation,conf,actor,payload);
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,'chair',mutation);
end $function$
;

