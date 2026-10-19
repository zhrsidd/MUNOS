-- Approval decision history. Additive only: one column, one table, three trigger functions.
-- Every Approval Panel decision on a resolution is recorded, including an approval with no comment, with
-- the reviewer, time, resolution version and review round. Decisions are separate from feedback text:
-- document_comments is unchanged, and a decision links to its comment only when one was written.
--
-- Why triggers: private.apply_mutation already runs every status change under mutation receipts, so a
-- replayed or duplicated mutation never reaches the update and never records a second decision. Recording on
-- the status transition covers every path that can change status and does not patch the core mutation.
--
-- Permissions: the table is read-only to authenticated and uses the same lifecycle-scoped policy as
-- document_comments (visible only where the parent document is visible). The Executive audit log is not
-- exposed to anyone new. There are no write grants; rows are written only by the trigger.

-- A review round starts each time the Chair submits (Draft -> Submitted). 0 means never submitted.
alter table public.documents add column review_round integer not null default 0 check (review_round >= 0);
-- Existing documents: anything past Draft has been submitted at least once. Prior decisions are not
-- reconstructed; history starts with this migration.
update public.documents set review_round = 1 where status <> 'Draft' or exists (select 1 from public.document_comments c where c."documentId" = documents.id);

create table public.document_decisions (
 id uuid primary key default gen_random_uuid(), conference_id uuid not null references public.conferences(id),
 committee_id uuid not null,
 "documentId" uuid not null,
 decision text not null check (decision in ('review_started','changes_requested','approved')),
 round integer not null check (round >= 1),
 "versionId" uuid, "versionNumber" integer,
 "reviewerId" uuid references auth.users(id), "reviewerName" text,
 "commentId" uuid,
 "decidedAt" timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key("documentId",conference_id,committee_id) references public.documents(id,conference_id,committee_id),
 foreign key("commentId") references public.document_comments(id),
 -- A decision of each kind happens at most once per review round.
 unique ("documentId", round, decision),
 unique (id, conference_id), unique(id,conference_id,committee_id), foreign key(committee_id,conference_id) references public.committees(id,conference_id)
);
create index document_decisions_document_idx on public.document_decisions("documentId", "decidedAt");
create index document_decisions_conference_idx on public.document_decisions(conference_id);
alter table public.document_decisions enable row level security;
revoke all on public.document_decisions from anon, authenticated;
grant select on public.document_decisions to authenticated;
create policy read_authorized on public.document_decisions for select to authenticated using (exists (select 1 from public.documents d where d.id = "documentId"));

create function private.document_round() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.status = 'Submitted' and old.status is distinct from 'Submitted' then new.review_round := old.review_round + 1; end if;
 return new;
end $$;
create trigger document_round before update of status on public.documents for each row execute function private.document_round();

create function private.record_document_decision() returns trigger language plpgsql security definer set search_path = '' as $$
declare kind text; v public.document_versions; reviewer uuid := auth.uid(); reviewer_name text;
begin
 kind := case
  when old.status = 'Submitted' and new.status = 'Review' then 'review_started'
  when old.status in ('Submitted','Review') and new.status = 'Approved' then 'approved'
  when old.status in ('Submitted','Review') and new.status = 'Draft' then 'changes_requested' end;
 if kind is null then return new; end if;
 select * into v from public.document_versions where "documentId" = new.id order by number desc limit 1;
 if reviewer is not null then
  select s.name into reviewer_name from public.staff s where s.auth_user_id = reviewer and s.conference_id = new.conference_id limit 1;
 end if;
 insert into public.document_decisions(conference_id, committee_id, "documentId", decision, round, "versionId", "versionNumber", "reviewerId", "reviewerName")
 values (new.conference_id, new.committee_id, new.id, kind, greatest(new.review_round, 1), v.id, v.number, reviewer, reviewer_name);
 return new;
end $$;
create trigger document_decision after update of status on public.documents for each row execute function private.record_document_decision();

-- Link a decision to the comment written in the same transaction (same transaction timestamp), if any.
create function private.link_decision_comment() returns trigger language plpgsql security definer set search_path = '' as $$
begin
 update public.document_decisions set "commentId" = new.id
  where "documentId" = new."documentId" and "decidedAt" = new."createdAt" and "commentId" is null and decision <> 'review_started';
 return new;
end $$;
create trigger document_comment_decision after insert on public.document_comments for each row execute function private.link_decision_comment();
revoke all on function private.document_round() from public, anon, authenticated;
revoke all on function private.record_document_decision() from public, anon, authenticated;
revoke all on function private.link_decision_comment() from public, anon, authenticated;

-- Publish through the operations snapshot (conference-wide, SECURITY INVOKER: the policy above applies).
-- Patched in place with an anchor that must occur once; fails closed if the base changes.
do $patch$
declare definition text; marker text := 'from public.photo_acknowledgements a where a.conference_id = conf)';
begin
 definition := pg_get_functiondef('public.operations_snapshot(uuid)'::regprocedure);
 if length(definition) - length(replace(definition, marker, '')) <> length(marker) then raise exception 'operations_snapshot anchor changed; review before applying'; end if;
 execute replace(definition, marker, marker || E',\n  ''documentDecisions'', (select coalesce(jsonb_agg(jsonb_build_object(''id'',d.id,''documentId'',d."documentId",''decision'',d.decision,''round'',d.round,''versionId'',d."versionId",''versionNumber'',d."versionNumber",''reviewerId'',d."reviewerId",''reviewerName'',d."reviewerName",''commentId'',d."commentId",''decidedAt'',d."decidedAt") order by d."decidedAt", d.id),''[]'')
    from public.document_decisions d where d.conference_id = conf)');
end $patch$;
