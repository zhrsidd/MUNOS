-- Conference OS development foundation. No anonymous grants or self-enrollment.
create schema if not exists private;
revoke all on schema private from public, anon;
create type public.conference_role as enum ('chair','approval','logistics','admin','observer');
create type public.attendance_state as enum ('Present','Present & Voting','Absent');
create type public.document_state as enum ('Draft','Submitted','Review','Approved','Printed','In Debate','Closed');
create type public.document_outcome as enum ('Passed','Failed','Withdrawn');
create table public.conferences (
 id uuid primary key default gen_random_uuid(), name text not null, venue text not null, date date not null,
 features jsonb not null default '{}', voting_rule text not null default 'simple_majority' check(voting_rule in ('simple_majority','two_thirds')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.committees (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 code text not null, name text not null, room text not null, voting_rule text check(voting_rule in ('simple_majority','two_thirds')), unique(conference_id,code),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.schools (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 name text not null, unique(conference_id,name),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.staff (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 name text not null, auth_user_id uuid references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.conference_staff (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 staff_id uuid not null, role public.conference_role not null, foreign key(staff_id,conference_id) references public.staff(id,conference_id), unique(conference_id,staff_id,role),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.committee_staff (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 staff_id uuid not null, foreign key(staff_id,conference_id) references public.staff(id,conference_id), unique(committee_id,staff_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.sessions (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 name text not null, "startsAt" timestamptz not null, state text not null check(state in ('scheduled','active','closed')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.delegates (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "schoolId" uuid not null, country text not null, flag text not null default '🌐', name text not null, email text not null, foreign key("schoolId",conference_id) references public.schools(id,conference_id), unique(conference_id,email),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.user_access (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 user_id uuid not null references auth.users(id), role public.conference_role not null,
 committee_id uuid, expires_at timestamptz not null, revoked_at timestamptz,
 foreign key(committee_id,conference_id) references public.committees(id,conference_id),
 check(role <> 'chair' or committee_id is not null), unique nulls not distinct(user_id,conference_id,role,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table private.access_credentials (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid, role public.conference_role not null, credential_hash text not null,
 expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
 foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
alter table private.access_credentials enable row level security;
create table public.attendance (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "delegateId" uuid not null, "sessionId" uuid not null, status public.attendance_state not null,
 "updatedAt" timestamptz not null default now(), revision bigint not null default 1,
 unique("sessionId","delegateId"),
 foreign key("delegateId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.scoring_definitions (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 committee_id uuid, code text not null, label text not null, values integer[] not null,
 check(cardinality(values)>0 and 0<=all(values) and 20>=all(values)),
 foreign key(committee_id,conference_id) references public.committees(id,conference_id),
 unique nulls not distinct(conference_id,committee_id,code),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.documents (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "sessionId" uuid not null, "submitterId" uuid not null, code text not null, title text not null,
 status public.document_state not null default 'Draft', outcome public.document_outcome,
 copies integer not null default 24 check(copies between 1 and 10000), revision bigint not null default 1,
 check ((status='Closed')=(outcome is not null)), unique(conference_id,code),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 foreign key("submitterId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create unique index documents_one_debate on public.documents(committee_id) where status='In Debate';
create table public.document_versions (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "documentId" uuid not null, number integer not null check(number>0), "createdAt" timestamptz not null default now(),
 "createdBy" uuid references auth.users(id), "fileName" text not null, "storageKey" text,
 text text not null, unique("documentId",number),
 foreign key("documentId",conference_id,committee_id) references public.documents(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.document_comments (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "documentId" uuid not null, text text not null, "authorId" uuid references auth.users(id), "createdAt" timestamptz not null default now(),
 foreign key("documentId",conference_id,committee_id) references public.documents(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.archive_jobs (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 version_id uuid not null, state text not null default 'pending' check(state in ('pending','synced','failed')), attempts integer not null default 0, archive_id text, last_error text,
 foreign key(version_id,conference_id,committee_id) references public.document_versions(id,conference_id,committee_id), unique(version_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.participation_events (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "delegateId" uuid not null, "categoryId" text not null, points integer not null check(points between 0 and 20),
 "sessionId" uuid not null, "resolutionId" uuid, "chairId" uuid references auth.users(id), "createdAt" timestamptz not null default now(), note text,
 foreign key("delegateId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 foreign key("resolutionId",conference_id,committee_id) references public.documents(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.participation_corrections (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 event_id uuid not null, points integer check(points between 0 and 20), voided boolean not null default false, actor_id uuid not null references auth.users(id),
 sequence bigint generated always as identity, check(voided or points is not null),
 foreign key(event_id,conference_id,committee_id) references public.participation_events(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.speaker_queue (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "delegateId" uuid not null, "sessionId" uuid not null, position bigint generated always as identity,
 state text not null default 'active' check(state in ('active','completed','removed')),
 foreign key("delegateId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create unique index queue_active_delegate on public.speaker_queue("sessionId","delegateId") where state='active';
create table public.timers (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "sessionId" uuid not null unique, duration integer not null check(duration between 1 and 7200), remaining numeric not null check(remaining between 0 and 7200),
 "startedAt" bigint, revision bigint not null default 1,
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.votes (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "delegateId" uuid not null, "sessionId" uuid not null, "resolutionId" uuid not null,
 choice text not null check(choice in ('For','Against','Abstain')), "createdAt" timestamptz not null default now(),
 revision bigint not null default 1, unique("delegateId","sessionId","resolutionId"),
 foreign key("delegateId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 foreign key("sessionId",conference_id,committee_id) references public.sessions(id,conference_id,committee_id),
 foreign key("resolutionId",conference_id,committee_id) references public.documents(id,conference_id,committee_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.award_criteria (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 committee_id uuid, name text not null, description text not null, max integer not null check(max between 1 and 100),
 foreign key(committee_id,conference_id) references public.committees(id,conference_id), unique nulls not distinct(conference_id,committee_id,name),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.award_scores (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "delegateId" uuid not null, "criterionId" uuid not null, score numeric not null check(score>=0), notes text not null default '', "chairId" uuid not null references auth.users(id),
 unique("delegateId","criterionId","chairId"),
 foreign key("delegateId",conference_id,committee_id) references public.delegates(id,conference_id,committee_id),
 foreign key("criterionId",conference_id) references public.award_criteria(id,conference_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create table public.audit_log (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 committee_id uuid, "actorId" uuid not null references auth.users(id), action text not null, "entityId" uuid, "createdAt" timestamptz not null default now(), mutation_id uuid not null unique, details jsonb not null,
 foreign key(committee_id,conference_id) references public.committees(id,conference_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table public.operational_changes (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),

 committee_id uuid, topic text not null check(topic in ('chair','documents','configuration')), mutation_id uuid not null unique,
 foreign key(committee_id,conference_id) references public.committees(id,conference_id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (id, conference_id)
);
create table private.mutation_receipts (
 id uuid primary key, conference_id uuid not null references public.conferences(id), actor_id uuid not null references auth.users(id),
 payload jsonb not null, created_at timestamptz not null default now()
);
alter table private.mutation_receipts enable row level security;
-- Membership checks are the only RLS bypass here; membership is never editable by a browser.
create function private.has_access(conf uuid, committee uuid, roles public.conference_role[]) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
 select 1 from public.user_access a where a.user_id=(select auth.uid()) and a.conference_id=conf
 and a.revoked_at is null and a.expires_at>now() and a.role=any(roles)
 and (a.committee_id is null or a.committee_id=committee)
 );
$$;
revoke all on function private.has_access(uuid,uuid,public.conference_role[]) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.has_access(uuid,uuid,public.conference_role[]) to authenticated;

alter table public.conferences enable row level security;
revoke all on public.conferences from anon,authenticated;
grant select on public.conferences to authenticated;
create policy read_authorized on public.conferences for select to authenticated using (exists(select 1 from public.user_access a where a.conference_id=conferences.id));
alter table public.committees enable row level security;
revoke all on public.committees from anon,authenticated;
grant select on public.committees to authenticated;
create policy read_authorized on public.committees for select to authenticated using (private.has_access(conference_id,id,array['admin','chair','approval','logistics','observer']::public.conference_role[]));
create index committees_conference_idx on public.committees(conference_id);
alter table public.schools enable row level security;
revoke all on public.schools from anon,authenticated;
grant select on public.schools to authenticated;
create policy read_authorized on public.schools for select to authenticated using ((private.has_access(conference_id,null,array['admin','chair','observer']::public.conference_role[]) or exists(select 1 from public.user_access a where a.conference_id=schools.conference_id and a.role='chair')));
create index schools_conference_idx on public.schools(conference_id);
alter table public.staff enable row level security;
revoke all on public.staff from anon,authenticated;
grant select on public.staff to authenticated;
create policy read_authorized on public.staff for select to authenticated using (private.has_access(conference_id,null,array['admin']::public.conference_role[]));
create index staff_conference_idx on public.staff(conference_id);
alter table public.conference_staff enable row level security;
revoke all on public.conference_staff from anon,authenticated;
grant select on public.conference_staff to authenticated;
create policy read_authorized on public.conference_staff for select to authenticated using (private.has_access(conference_id,null,array['admin']::public.conference_role[]));
create index conference_staff_conference_idx on public.conference_staff(conference_id);
alter table public.committee_staff enable row level security;
revoke all on public.committee_staff from anon,authenticated;
grant select on public.committee_staff to authenticated;
create policy read_authorized on public.committee_staff for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index committee_staff_conference_idx on public.committee_staff(conference_id);
alter table public.sessions enable row level security;
revoke all on public.sessions from anon,authenticated;
grant select on public.sessions to authenticated;
create policy read_authorized on public.sessions for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','approval','logistics','observer']::public.conference_role[]));
create index sessions_conference_idx on public.sessions(conference_id);
alter table public.delegates enable row level security;
revoke all on public.delegates from anon,authenticated;
grant select on public.delegates to authenticated;
create policy read_authorized on public.delegates for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index delegates_conference_idx on public.delegates(conference_id);
alter table public.user_access enable row level security;
revoke all on public.user_access from anon,authenticated;
grant select on public.user_access to authenticated;
create policy read_authorized on public.user_access for select to authenticated using (user_id=(select auth.uid()) and revoked_at is null and expires_at>now());
create index user_access_conference_idx on public.user_access(conference_id);
alter table public.attendance enable row level security;
revoke all on public.attendance from anon,authenticated;
grant select on public.attendance to authenticated;
create policy read_authorized on public.attendance for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index attendance_conference_idx on public.attendance(conference_id);
alter table public.scoring_definitions enable row level security;
revoke all on public.scoring_definitions from anon,authenticated;
grant select on public.scoring_definitions to authenticated;
create policy read_authorized on public.scoring_definitions for select to authenticated using ((private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]) or exists(select 1 from public.user_access a where a.conference_id=scoring_definitions.conference_id and a.role='chair')));
create index scoring_definitions_conference_idx on public.scoring_definitions(conference_id);
alter table public.documents enable row level security;
revoke all on public.documents from anon,authenticated;
grant select on public.documents to authenticated;
create policy read_authorized on public.documents for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','approval','logistics','observer']::public.conference_role[]));
create index documents_conference_idx on public.documents(conference_id);
alter table public.document_versions enable row level security;
revoke all on public.document_versions from anon,authenticated;
grant select on public.document_versions to authenticated;
create policy read_authorized on public.document_versions for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','approval','logistics','observer']::public.conference_role[]));
create index document_versions_conference_idx on public.document_versions(conference_id);
alter table public.document_comments enable row level security;
revoke all on public.document_comments from anon,authenticated;
grant select on public.document_comments to authenticated;
create policy read_authorized on public.document_comments for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','approval','logistics','observer']::public.conference_role[]));
create index document_comments_conference_idx on public.document_comments(conference_id);
alter table public.archive_jobs enable row level security;
revoke all on public.archive_jobs from anon,authenticated;
grant select on public.archive_jobs to authenticated;
create policy read_authorized on public.archive_jobs for select to authenticated using (private.has_access(conference_id,committee_id,array['admin']::public.conference_role[]));
create index archive_jobs_conference_idx on public.archive_jobs(conference_id);
alter table public.participation_events enable row level security;
revoke all on public.participation_events from anon,authenticated;
grant select on public.participation_events to authenticated;
create policy read_authorized on public.participation_events for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index participation_events_conference_idx on public.participation_events(conference_id);
alter table public.participation_corrections enable row level security;
revoke all on public.participation_corrections from anon,authenticated;
grant select on public.participation_corrections to authenticated;
create policy read_authorized on public.participation_corrections for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index participation_corrections_conference_idx on public.participation_corrections(conference_id);
alter table public.speaker_queue enable row level security;
revoke all on public.speaker_queue from anon,authenticated;
grant select on public.speaker_queue to authenticated;
create policy read_authorized on public.speaker_queue for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index speaker_queue_conference_idx on public.speaker_queue(conference_id);
alter table public.timers enable row level security;
revoke all on public.timers from anon,authenticated;
grant select on public.timers to authenticated;
create policy read_authorized on public.timers for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index timers_conference_idx on public.timers(conference_id);
alter table public.votes enable row level security;
revoke all on public.votes from anon,authenticated;
grant select on public.votes to authenticated;
create policy read_authorized on public.votes for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index votes_conference_idx on public.votes(conference_id);
alter table public.award_criteria enable row level security;
revoke all on public.award_criteria from anon,authenticated;
grant select on public.award_criteria to authenticated;
create policy read_authorized on public.award_criteria for select to authenticated using ((private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]) or exists(select 1 from public.user_access a where a.conference_id=award_criteria.conference_id and a.role='chair')));
create index award_criteria_conference_idx on public.award_criteria(conference_id);
alter table public.award_scores enable row level security;
revoke all on public.award_scores from anon,authenticated;
grant select on public.award_scores to authenticated;
create policy read_authorized on public.award_scores for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[]));
create index award_scores_conference_idx on public.award_scores(conference_id);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon,authenticated;
grant select on public.audit_log to authenticated;
create policy read_authorized on public.audit_log for select to authenticated using (private.has_access(conference_id,committee_id,array['admin']::public.conference_role[]));
create index audit_log_conference_idx on public.audit_log(conference_id);
alter table public.operational_changes enable row level security;
revoke all on public.operational_changes from anon,authenticated;
grant select on public.operational_changes to authenticated;
create policy read_authorized on public.operational_changes for select to authenticated using (private.has_access(conference_id,committee_id,array['admin','chair','approval','logistics','observer']::public.conference_role[]));
create index operational_changes_conference_idx on public.operational_changes(conference_id);
create index access_lookup on public.user_access(user_id,conference_id,role,committee_id) where revoked_at is null;
create index attendance_session on public.attendance("sessionId",status);
create index events_delegate_session on public.participation_events("delegateId","sessionId");
create index corrections_event on public.participation_corrections(event_id,sequence desc);
create index queue_session on public.speaker_queue("sessionId",position) where state='active';
create index documents_inbox on public.documents(conference_id,status,committee_id);
create index votes_document on public.votes("resolutionId","sessionId");
create index audit_history on public.audit_log(conference_id,"createdAt" desc);
create index changes_scope on public.operational_changes(conference_id,committee_id,created_at desc);
-- Views preserve RLS. Corrections append; original awarded points remain immutable.
create view public.participation_history with (security_invoker=true) as
select e.*,coalesce(c.points,e.points) as effective_points,case when c.voided then c.created_at end as voided_at,
 c.created_at as corrected_at from public.participation_events e
left join lateral(select * from public.participation_corrections c where c.event_id=e.id order by sequence desc limit 1)c on true;
revoke all on public.participation_history from anon;
grant select on public.participation_history to authenticated;

create function public.conference_snapshot(conf uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.conferences where id=conf) then raise exception 'Conference access has not been granted' using errcode='42501'; end if;
 select jsonb_build_object(
 'conference',(select jsonb_build_object('id',id,'name',name,'venue',venue,'date',date,'features',features,'votingRule',voting_rule) from public.conferences where id=conf),
 'committees',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('conferenceId',conference_id,'votingRule',voting_rule,'scoringOverrides',(select jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values)) from public.scoring_definitions s where s.committee_id=x.id)) order by x.created_at,x.id),'[]') from public.committees x where conference_id=conf),
 'schools',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.schools x where conference_id=conf),
 'staff',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('role',coalesce((select role::text from public.conference_staff f where f.staff_id=x.id limit 1),'chair'),'committeeIds',(select coalesce(jsonb_agg(committee_id),'[]') from public.committee_staff a where a.staff_id=x.id)) order by x.created_at,x.id),'[]') from public.staff x where conference_id=conf),
 'sessions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.sessions x where conference_id=conf),
 'delegates',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.delegates x where conference_id=conf),
 'attendance',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.attendance x where conference_id=conf),
 'documents',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id,'versionIds',(select coalesce(jsonb_agg(v.id order by number),'[]') from public.document_versions v where v."documentId"=x.id),'comments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'text',text,'authorId',"authorId",'createdAt',"createdAt") order by "createdAt"),'[]') from public.document_comments c where c."documentId"=x.id)) order by x.created_at,x.id),'[]') from public.documents x where conference_id=conf),
 'versions',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.document_versions x where conference_id=conf),
 'events',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('points',effective_points,'voidedAt',voided_at,'updatedAt',corrected_at,'revision',(select count(*) from public.participation_corrections c where c.event_id=x.id)) order by x.created_at,x.id),'[]') from public.participation_history x where conference_id=conf),
 'queue',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.speaker_queue x where conference_id=conf and state='active'),
 'votes',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.votes x where conference_id=conf),
 'scoring',(select coalesce(jsonb_agg(jsonb_build_object('id',code,'label',label,'values',values) order by x.created_at,x.id),'[]') from public.scoring_definitions x where conference_id=conf and committee_id is null),
 'criteria',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' || jsonb_build_object('committeeId',committee_id) order by x.created_at,x.id),'[]') from public.award_criteria x where conference_id=conf),
 'awardScores',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.award_scores x where conference_id=conf),
 'audit',(select coalesce(jsonb_agg(to_jsonb(x)-'conference_id'-'committee_id'-'created_at'-'updated_at' order by x.created_at,x.id),'[]') from public.audit_log x where conference_id=conf),
 'timers',(select coalesce(jsonb_object_agg("sessionId",jsonb_build_object('duration',duration,'remaining',remaining,'startedAt',"startedAt",'revision',revision)),'{}') from public.timers where conference_id=conf)
 ) into result;
 return result;
end; $$;
revoke all on function public.conference_snapshot(uuid) from public,anon;
grant execute on function public.conference_snapshot(uuid) to authenticated;
-- Private command boundary: atomic authorization, validation, domain write, audit and receipt.
-- Direct DML is revoked. Browser-supplied role selects an interface; membership authorizes it.
create function private.apply_mutation(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
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
   if not exists(select 1 from public.documents where id=rid and conference_id=conf and committee_id=cid and "sessionId"=sid) then raise exception 'Resolution outside session' using errcode='22023'; end if;
 end if;
 if kind in ('document','version') then
   select * into rec from public.documents where id=rid;
   actual:=rec.revision::text;
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
   if target='Closed' then
     if command->>'outcome'='Withdrawn' then result:='Withdrawn';
     else
       select count(*) into n from public.attendance where "sessionId"=sid and status<>'Absent';
       if n=0 or n<>(select count(*) from public.votes where "resolutionId"=rid and "sessionId"=sid) then raise exception 'Record every eligible ballot before closing' using errcode='22023'; end if;
       select count(*) filter(where choice='For'),count(*) filter(where choice='Against') into yes_votes,no_votes from public.votes where "resolutionId"=rid and "sessionId"=sid;
       select coalesce(c.voting_rule,f.voting_rule) into rule from public.committees c join public.conferences f on f.id=c.conference_id where c.id=cid;
       result:=case when yes_votes+no_votes>0 and ((rule='simple_majority' and yes_votes>no_votes) or (rule='two_thirds' and yes_votes*3>=(yes_votes+no_votes)*2)) then 'Passed'::public.document_outcome else 'Failed'::public.document_outcome end;
       if command->>'outcome' is distinct from result::text then raise exception 'Outcome differs from configured voting rule' using errcode='22023'; end if;
     end if;
   end if;
   update public.documents set status=target::public.document_state,outcome=result,revision=revision+1,updated_at=now() where id=rid;
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
 when 'award' then
   if not exists(select 1 from public.award_criteria where id=(command->>'criterionId')::uuid and conference_id=conf and (committee_id is null or committee_id=cid) and (command->>'score')::numeric between 0 and max) then raise exception 'Invalid award criterion or score' using errcode='22023'; end if;
   insert into public.award_scores(id,conference_id,committee_id,"delegateId","criterionId",score,notes,"chairId") values(new_id,conf,cid,did,(command->>'criterionId')::uuid,(command->>'score')::numeric,command->>'notes',actor)
   on conflict("delegateId","criterionId","chairId") do update set score=excluded.score,notes=excluded.notes,updated_at=now();
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
 when 'criterion' then
   topic:='configuration'; update public.award_criteria set name=command->>'name',description=command->>'description',max=(command->>'max')::integer,updated_at=now() where id=(command->>'id')::uuid and conference_id=conf;
 when 'staff' then
   topic:='configuration'; insert into public.staff(id,conference_id,name) values(new_id,conf,command->>'name');
   insert into public.conference_staff(conference_id,staff_id,role) values(conf,new_id,(command->>'role')::public.conference_role);
   for row_data in select * from jsonb_array_elements(command->'committeeIds') loop insert into public.committee_staff(conference_id,committee_id,staff_id) values(conf,(row_data#>>'{}')::uuid,new_id); end loop;
 else raise exception 'Unknown conference command' using errcode='22023';
 end case;
 entity:=coalesce(rid,did,ev.id,cid,conf);
 insert into public.audit_log(conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values(conf,cid,actor,case when kind='document' then 'Resolution → '||target else kind||' updated' end,entity,mutation,command);
 insert into private.mutation_receipts(id,conference_id,actor_id,payload) values(mutation,conf,actor,payload);
 -- The timer has no Realtime event: countdown and start/pause/reset remain local calculations.
 if kind<>'timer' then insert into public.operational_changes(conference_id,committee_id,topic,mutation_id) values(conf,cid,topic,mutation); end if;
end; $$;
revoke all on function private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) from public,anon;
grant execute on function private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;
create function public.apply_conference_mutation(conf uuid,mutation uuid,command jsonb,requested_role public.conference_role,expected text,client_time timestamptz)
returns void language sql security invoker set search_path='' as $$ select private.apply_mutation(conf,mutation,command,requested_role,expected,client_time); $$;
revoke all on function public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) from public,anon;
grant execute on function public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;
-- Index every referencing FK that lacks a matching leading index (small normalized tables included).
do $$ declare r record; begin
 for r in select conrelid::regclass as tbl, conname, array_to_string(array(select quote_ident(attname) from unnest(conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=conrelid and a.attnum=k.num order by ord),',') as cols
 from pg_constraint c where contype='f' and connamespace in ('public'::regnamespace,'private'::regnamespace)
 and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and (i.indkey::smallint[])[0:cardinality(c.conkey)-1]=c.conkey)
 loop execute format('create index %I on %s (%s)',left(r.conname,55)||'_fkidx',r.tbl,r.cols); end loop;
end $$;
-- Publication is conditional so this same migration can be tested in plain PostgreSQL.
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.operational_changes; end if; end $$;
