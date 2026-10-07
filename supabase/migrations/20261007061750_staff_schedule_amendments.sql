-- LOCAL/TEST ONLY until release consolidation. Existing sessions remain unlinked historical rows.
-- No automatic matching by name/time: committee-local IDs and every historical FK are preserved.
alter table public.committees add column archived boolean not null default false, add column revision bigint not null default 1;
create table public.conference_session_slots (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 name text not null check(length(btrim(name)) between 1 and 200), "startsAt" timestamptz not null,
 "endsAt" timestamptz, archived boolean not null default false, revision bigint not null default 1,
 created_at timestamptz not null default now(), unique(id,conference_id), check("endsAt" is null or "endsAt">"startsAt")
);
create index session_slots_conference on public.conference_session_slots(conference_id,"startsAt");
alter table public.sessions add column "slotId" uuid, add column archived boolean not null default false,
 add foreign key("slotId",conference_id) references public.conference_session_slots(id,conference_id),
 add unique("slotId",committee_id);
alter table public.conference_session_slots enable row level security;
revoke all on public.conference_session_slots from public,anon,authenticated;
grant select on public.conference_session_slots to authenticated;
create policy read_authorized on public.conference_session_slots for select to authenticated using(private.has_access(conference_id,null,array['admin','chair','approval','logistics','observer']::public.conference_role[]));

create table public.amendment_links (
 id uuid primary key default gen_random_uuid(),conference_id uuid not null references public.conferences(id),committee_id uuid not null,
 token text not null unique check(token ~ '^[A-Za-z0-9_-]{22,64}$'),created_at timestamptz not null default now(),revoked_at timestamptz,
 foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create unique index amendment_links_active on public.amendment_links(committee_id) where revoked_at is null;
create index amendment_links_conference on public.amendment_links(conference_id);
create table public.amendments (
 id uuid primary key default gen_random_uuid(),conference_id uuid not null references public.conferences(id),committee_id uuid not null,
 "resolutionId" uuid not null,"sessionId" uuid not null,"submitterId" uuid not null,
 type text not null check(type in ('Add','Strike','Replace')),clause text not null check(length(btrim(clause)) between 1 and 200),
 wording text not null check(length(btrim(wording)) between 1 and 4000),
 status text not null default 'Submitted' check(status in ('Submitted','Accepted for Debate','In Debate','Closed')),
 outcome text check(outcome in ('Passed','Failed','Withdrawn','Ruled Out')),"createdAt" timestamptz not null default now(),revision bigint not null default 1,
 check((status='Closed')=(outcome is not null)),
 foreign key(committee_id,conference_id) references public.committees(id,conference_id),
 foreign key("resolutionId",conference_id,committee_id) references public.documents(id,conference_id,committee_id),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 foreign key("submitterId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id)
);
create unique index amendment_one_debate on public.amendments(committee_id) where status='In Debate';
create index amendments_current on public.amendments(conference_id,"resolutionId","createdAt" desc);
create index amendments_session on public.amendments("sessionId");
create index amendments_submitter on public.amendments("submitterId");
create index amendments_committee on public.amendments(committee_id);
alter table public.amendment_links enable row level security;
alter table public.amendments enable row level security;
revoke all on public.amendment_links,public.amendments from public,anon,authenticated;
grant select on public.amendment_links,public.amendments to authenticated;
create policy read_authorized on public.amendment_links for select to authenticated using(private.has_access(conference_id,committee_id,array['admin','chair']::public.conference_role[]));
create policy read_authorized on public.amendments for select to authenticated using(private.has_access(conference_id,committee_id,array['admin','chair']::public.conference_role[]));
create table private.amendment_submissions (
 id uuid primary key,link_id uuid not null references public.amendment_links(id),amendment_id uuid not null references public.amendments(id),
 payload jsonb not null,created_at timestamptz not null default now()
);
alter table private.amendment_submissions enable row level security;
create index amendment_submission_rate on private.amendment_submissions(link_id,created_at desc);
create index amendment_submission_record on private.amendment_submissions(amendment_id);
revoke all on private.amendment_submissions from public,anon,authenticated;

-- Safe-delete checks discover every FK referencing the target id, including future owned tables.
-- Invoked only inside the authorized definer mutation; never exposed to clients.
create function private.batch_has_references(target regclass,target_id uuid,ignored regclass[] default '{}') returns boolean
language plpgsql set search_path='' as $$
declare ref record; used boolean;
begin
 for ref in select distinct c.conrelid::regclass as rel,a.attname as col from pg_catalog.pg_constraint c
 cross join lateral unnest(c.confkey,c.conkey) k(remote_key,local_key)
 join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.local_key
 join pg_catalog.pg_attribute b on b.attrelid=c.confrelid and b.attnum=k.remote_key
 where c.contype='f' and c.confrelid=target and b.attname='id' and not c.conrelid=any(ignored) loop
  execute format('select exists(select 1 from %s where %I=$1)',ref.rel,ref.col) into used using target_id;
  if used then return true; end if;
 end loop;
 return false;
end $$;
revoke all on function private.batch_has_references(regclass,uuid,regclass[]) from public,anon,authenticated;

-- The core committee-create command already locks the conference, serializing slot materialization.
create function private.materialize_new_committee_slots() returns trigger language plpgsql set search_path='' as $$
declare slot public.conference_session_slots;n integer:=1;
begin
 for slot in select * from public.conference_session_slots where conference_id=new.conference_id and not archived order by id loop
  n:=n+1;
  insert into public.sessions(id,conference_id,committee_id,"slotId",name,"startsAt","endsAt",state)
  values((substr(new.id::text,1,24)||lpad(to_hex(n),12,'0'))::uuid,new.conference_id,new.id,slot.id,slot.name,slot."startsAt",slot."endsAt",'scheduled');
 end loop;
 return new;
end $$;
revoke all on function private.materialize_new_committee_slots() from public,anon,authenticated;
create trigger materialize_central_sessions after insert on public.committees for each row execute function private.materialize_new_committee_slots();

create function private.apply_staff_batch(conf uuid,mutation uuid,command jsonb,requested_role public.conference_role,expected text,client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();kind text:=command->>'type';action text:=command->>'action';cid uuid;entity uuid;sid uuid;
 new_id uuid:=(substr(mutation::text,1,24)||'000000000001')::uuid;counter integer:=1;
 prior private.mutation_receipts;actual text;slot public.conference_session_slots;committee public.committees;amend public.amendments;
 payload jsonb:=jsonb_build_object('command',command,'role',requested_role,'expected',expected,'client_time',client_time);
 topic text:='configuration';target text:=command->>'status';outcome_value text:=command->>'outcome';
begin
 if actor is null then raise exception 'Session required' using errcode='42501';end if;
 if pg_column_size(command)>16384 then raise exception 'Command too large' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(mutation::text,0));
 select * into prior from private.mutation_receipts where id=mutation;
 if found then
  if prior.actor_id<>actor or prior.conference_id<>conf or prior.payload<>payload then raise exception 'Idempotency key reused for a different action' using errcode='22023';end if;return;
 end if;
 if kind='amendmentStatus' then select * into amend from public.amendments where id=(command->>'id')::uuid and conference_id=conf;cid:=amend.committee_id;
 elsif kind in ('committeeUpdate','committeeLifecycle') then cid:=(command->>'id')::uuid;
 elsif kind='amendmentLink' then cid:=(command->>'committeeId')::uuid;end if;
 if requested_role is distinct from (case when kind='amendmentStatus' then 'chair'::public.conference_role else 'admin'::public.conference_role end)
 or not private.has_access(conf,cid,array[requested_role]) then raise exception 'Access denied' using errcode='42501';end if;
 if kind<>'amendmentStatus' then perform 1 from public.conferences where id=conf for update;end if;
 if cid is not null then select * into committee from public.committees where id=cid and conference_id=conf for update;
  if not found then raise exception 'Committee unavailable' using errcode='42501';end if;
 else perform 1 from public.committees where conference_id=conf order by id for update;end if;
 if kind='amendmentStatus' then
  select * into amend from public.amendments where id=(command->>'id')::uuid and conference_id=conf for update;actual:=amend.revision::text;
 elsif kind in ('committeeUpdate','committeeLifecycle') then actual:=committee.revision::text;
 elsif kind='sessionSlot' and action<>'create' then select * into slot from public.conference_session_slots where id=(command->>'id')::uuid and conference_id=conf for update;actual:=slot.revision::text;
 elsif kind='amendmentLink' then select coalesce((select id::text from public.amendment_links where committee_id=cid and revoked_at is null),'none') into actual;end if;
 if (kind in ('amendmentStatus','committeeUpdate','committeeLifecycle') or (kind='sessionSlot' and action<>'create')) and actual is null then raise exception 'Record unavailable' using errcode='42501';end if;
 if actual is not null and actual is distinct from expected then raise exception 'This record changed. Review before retrying.' using errcode='PT409';end if;
 entity:=coalesce(cid,slot.id,new_id);
 case kind
 when 'committeeUpdate' then
  if coalesce(length(btrim(command->>'code')),0) not between 1 and 30 or coalesce(length(btrim(command->>'name')),0) not between 1 and 200 or coalesce(length(command->>'room'),0)>200 then raise exception 'Enter a valid committee code, name and room' using errcode='22023';end if;
  update public.committees set code=btrim(command->>'code'),name=btrim(command->>'name'),room=btrim(command->>'room'),revision=revision+1 where id=cid;
 when 'committeeLifecycle' then
  if action='archive' then update public.committees set archived=true,revision=revision+1,"currentSessionId"=null,"sessionRevision"="sessionRevision"+1 where id=cid;
  elsif action='delete' then
   if private.batch_has_references('public.committees',cid,array['public.sessions'::regclass]) then raise exception 'Committee has linked records. Archive it to preserve history.' using errcode='22023';end if;
   for sid in select id from public.sessions where committee_id=cid loop
    if private.batch_has_references('public.sessions',sid) then raise exception 'Committee sessions have history. Archive the committee instead.' using errcode='22023';end if;
   end loop;
   delete from public.sessions where committee_id=cid;delete from public.committees where id=cid;
  else raise exception 'Unknown committee action' using errcode='22023';end if;
  -- Audit references the preserved entity UUID without retaining a FK to a deleted committee.
  cid:=null;
 when 'sessionSlot' then
  if action='create' then
   insert into public.conference_session_slots(id,conference_id,name,"startsAt","endsAt") values(new_id,conf,btrim(command->>'name'),(command->>'startsAt')::timestamptz,(command->>'endsAt')::timestamptz);
   for committee in select * from public.committees where conference_id=conf and not archived order by id loop
    counter:=counter+1;
    insert into public.sessions(id,conference_id,committee_id,"slotId",name,"startsAt","endsAt",state) values((substr(mutation::text,1,24)||lpad(to_hex(counter),12,'0'))::uuid,conf,committee.id,new_id,btrim(command->>'name'),(command->>'startsAt')::timestamptz,(command->>'endsAt')::timestamptz,'scheduled');
   end loop;
  elsif action='update' then
   if slot.archived then raise exception 'Archived session cannot be edited' using errcode='22023';end if;
   update public.conference_session_slots set name=btrim(command->>'name'),"startsAt"=(command->>'startsAt')::timestamptz,"endsAt"=(command->>'endsAt')::timestamptz,revision=revision+1 where id=slot.id;
   update public.sessions set name=btrim(command->>'name'),"startsAt"=(command->>'startsAt')::timestamptz,"endsAt"=(command->>'endsAt')::timestamptz where "slotId"=slot.id;
  elsif action='archive' then
   update public.conference_session_slots set archived=true,revision=revision+1 where id=slot.id;
   update public.sessions set archived=true,state='closed' where "slotId"=slot.id;
   update public.committees set "currentSessionId"=null,"sessionRevision"="sessionRevision"+1 where "currentSessionId" in (select id from public.sessions where "slotId"=slot.id);
  elsif action='delete' then
   for sid in select id from public.sessions where "slotId"=slot.id loop
    if private.batch_has_references('public.sessions',sid) then raise exception 'Session has operational history. Archive the slot instead.' using errcode='22023';end if;
   end loop;
   delete from public.sessions where "slotId"=slot.id;delete from public.conference_session_slots where id=slot.id;
  else raise exception 'Unknown session action' using errcode='22023';end if;
 when 'amendmentLink' then
  topic:='documents';if committee.archived then raise exception 'Committee is archived' using errcode='22023';end if;
  if action='create' and actual<>'none' then raise exception 'An amendment link already exists. Replace it instead.' using errcode='22023';end if;
  if action not in ('create','rotate','revoke') then raise exception 'Unknown link action' using errcode='22023';end if;
  update public.amendment_links set revoked_at=now() where committee_id=cid and revoked_at is null;
  if action<>'revoke' then insert into public.amendment_links(id,conference_id,committee_id,token) values(new_id,conf,cid,command->>'token');end if;
 when 'amendmentStatus' then
  entity:=amend.id;topic:='documents';
  if committee.archived or not exists(select 1 from public.documents where id=amend."resolutionId" and status='In Debate') then raise exception 'Amendments are not currently open in this committee.' using errcode='22023';end if;
  if not coalesce((amend.status='Submitted' and target='Accepted for Debate' and outcome_value is null) or (amend.status='Accepted for Debate' and target='In Debate' and outcome_value is null) or (amend.status<>'Closed' and target='Closed' and (outcome_value in ('Ruled Out','Withdrawn') or (amend.status='In Debate' and outcome_value in ('Passed','Failed')))),false) then raise exception 'Invalid amendment transition' using errcode='22023';end if;
  if target='In Debate' and exists(select 1 from public.amendments where committee_id=cid and status='In Debate' and id<>amend.id) then raise exception 'Close the current amendment debate first' using errcode='22023';end if;
  update public.amendments set status=target,outcome=outcome_value,revision=revision+1 where id=amend.id;
 else raise exception 'Unknown batch command' using errcode='22023';end case;
 insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values(conf,cid,actor,kind||' updated',entity,mutation,command-'token');
 insert into private.mutation_receipts(id,conference_id,actor_id,payload) values(mutation,conf,actor,payload);
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,topic,mutation);
 -- Central configuration must reach committee-filtered Chair channels without broadening subscriptions.
 if kind='sessionSlot' then
  for committee in select * from public.committees where conference_id=conf loop
   insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,committee.id,'configuration',gen_random_uuid());
  end loop;
 end if;
end $$;
revoke all on function private.apply_staff_batch(uuid,uuid,jsonb,public.conference_role,text,timestamptz) from public,anon;
grant execute on function private.apply_staff_batch(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;
create or replace function public.apply_conference_mutation(conf uuid,mutation uuid,command jsonb,requested_role public.conference_role,expected text,client_time timestamptz)
returns void language plpgsql security invoker set search_path='' as $$ begin
 if command->>'type' in ('committeeUpdate','committeeLifecycle','sessionSlot','amendmentLink','amendmentStatus') then
  perform private.apply_staff_batch(conf,mutation,command,requested_role,expected,client_time);
 elsif command->>'type' in ('currentSession','debateMode','queueAdd','queueOrder','queueRemove','speechStart','speechYield','speechScore','speechFinish','poiAllowance','poiAdd','poiOrder','poiRecognize','voteMode','vetoRules') then
  perform private.apply_procedure(conf,mutation,command,requested_role,expected,client_time);
 else perform private.apply_mutation(conf,mutation,command,requested_role,expected,client_time);end if;
end $$;

-- Public pages expose only committee, current resolution and delegation choices; never staff/private fields.
create function public.amendment_link_info(link_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('committee',jsonb_build_object('id',c.id,'code',c.code,'name',c.name),
  'resolution',(select jsonb_build_object('id',d.id,'code',d.code,'title',d.title) from public.documents d where d.committee_id=c.id and d.status='In Debate' and d."sessionId"=c."currentSessionId" order by d.created_at,d.id limit 1),
  'delegates',(select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'country',d.country) order by d.country,d.id),'[]') from public.delegates d where d.committee_id=c.id))
 from public.amendment_links l join public.committees c on c.id=l.committee_id where l.token=link_token and l.revoked_at is null and not c.archived;
$$;
revoke all on function public.amendment_link_info(text) from public,anon,authenticated;
grant execute on function public.amendment_link_info(text) to service_role;

create function public.submit_amendment(link_token text,submission uuid,submitter uuid,resolution uuid,amendment_type text,clause text,wording text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.amendment_links;c public.committees;doc public.documents;prior private.amendment_submissions;existing uuid;
 p jsonb:=jsonb_build_object('submitter',submitter,'resolution',resolution,'type',amendment_type,'clause',btrim(clause),'wording',btrim(wording));
begin
 if submission is null then raise exception 'idempotency_conflict' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(submission::text,0));
 -- Committee lock matches Chair lifecycle writes. Recheck the link after acquiring it.
 select * into l from public.amendment_links where token=link_token and revoked_at is null;
 if not found then raise exception 'invalid_link' using errcode='22023';end if;
 select * into c from public.committees where id=l.committee_id for update;
 select * into l from public.amendment_links where token=link_token and revoked_at is null;
 if not found or c.archived then raise exception 'invalid_link' using errcode='22023';end if;
 select * into prior from private.amendment_submissions where id=submission;
 if found then
  if prior.link_id<>l.id or prior.payload<>p then raise exception 'idempotency_conflict' using errcode='22023';end if;
  return jsonb_build_object('status','replayed','id',prior.amendment_id);
 end if;
 select * into doc from public.documents where id=resolution and committee_id=l.committee_id and status='In Debate' and "sessionId"=c."currentSessionId";
 if not found then raise exception 'not_open' using errcode='22023';end if;
 if not exists(select 1 from public.delegates where id=submitter and committee_id=l.committee_id and conference_id=l.conference_id) then raise exception 'invalid_submitter' using errcode='22023';end if;
 if amendment_type is null or amendment_type not in ('Add','Strike','Replace') or coalesce(length(btrim(clause)),0) not between 1 and 200 or coalesce(length(btrim(wording)),0) not between 1 and 4000 then raise exception 'invalid_amendment' using errcode='22023';end if;
 select a.id into existing from public.amendments a where a."resolutionId"=resolution and a."submitterId"=submitter and a.type=amendment_type and a.clause=btrim(submit_amendment.clause) and a.wording=btrim(submit_amendment.wording) order by a."createdAt" limit 1;
 if existing is not null then return jsonb_build_object('status','duplicate','id',existing);end if;
 if (select count(*) from private.amendment_submissions where link_id=l.id and created_at>now()-interval '10 minutes')>=20 or (select count(*) from public.amendments where "submitterId"=submitter and committee_id=l.committee_id and "createdAt">now()-interval '10 minutes')>=5 then raise exception 'rate_limited' using errcode='P0001';end if;
 insert into public.amendments(id,conference_id,committee_id,"resolutionId","sessionId","submitterId",type,clause,wording) values(submission,l.conference_id,l.committee_id,resolution,doc."sessionId",submitter,amendment_type,btrim(clause),btrim(wording));
 insert into private.amendment_submissions(id,link_id,amendment_id,payload) values(submission,l.id,submission,p);
 -- Delegate is not an auth user: its immutable submission record is the public action's audit trail.
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(l.conference_id,l.committee_id,'documents',submission);
 return jsonb_build_object('status','created','id',submission);
end $$;
revoke all on function public.submit_amendment(text,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_amendment(text,uuid,uuid,uuid,text,text,text) to service_role;

-- Current amendment work only; complete history stays queryable under table RLS.
create function public.staff_batch_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'sessionSlots',(select coalesce(jsonb_agg(to_jsonb(s)-'conference_id'-'created_at' order by s."startsAt",s.id),'[]') from public.conference_session_slots s where conference_id=conf),
 'amendmentLinks',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'committeeId',l.committee_id,'token',l.token,'createdAt',l.created_at)),'[]') from public.amendment_links l where conference_id=conf and revoked_at is null),
 'amendments',(select coalesce(jsonb_agg(to_jsonb(a)-'conference_id'-'committee_id'||jsonb_build_object('committeeId',a.committee_id) order by a."createdAt",a.id),'[]') from
  (select a.* from public.amendments a join public.documents d on d.id=a."resolutionId" where a.conference_id=conf and d.status='In Debate' order by a."createdAt" desc,a.id desc limit 200) a)
 );
$$;
revoke all on function public.staff_batch_snapshot(uuid) from public,anon;
grant execute on function public.staff_batch_snapshot(uuid) to authenticated;
create or replace function public.conference_state_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.conference_snapshot(conf)||coalesce(public.operations_snapshot(conf),'{}')||public.staff_batch_snapshot(conf)
$$;
create or replace function public.executive_state_snapshot(conf uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.executive_snapshot(conf)||coalesce(public.operations_snapshot(conf),'{}')||public.staff_batch_snapshot(conf)
$$;
