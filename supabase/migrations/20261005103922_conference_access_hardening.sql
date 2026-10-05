-- Supabase's pre-existing DDL event helper is not a browser RPC.
-- Revoking EXECUTE does not disable its database event trigger.
do $$ begin if to_regprocedure('public.rls_auto_enable()') is not null then
 revoke execute on function public.rls_auto_enable() from public,anon,authenticated;
end if; end $$;
-- Explicit deny policies document intentionally private service-only state.
create policy no_browser_access on private.access_credentials for all to anon,authenticated using(false) with check(false);
create policy no_browser_access on private.mutation_receipts for all to anon,authenticated using(false) with check(false);
-- Operational roles see only relevant document lifecycle states.
drop policy read_authorized on public.documents;
create policy read_authorized on public.documents for select to authenticated using (
 private.has_access(conference_id,committee_id,array['chair','admin','observer']::public.conference_role[])
 or (status in ('Submitted','Review','Approved') and private.has_access(conference_id,committee_id,array['approval']::public.conference_role[]))
 or (status in ('Approved','Printed','In Debate','Closed') and private.has_access(conference_id,committee_id,array['logistics']::public.conference_role[]))
);
drop policy read_authorized on public.document_versions;
create policy read_authorized on public.document_versions for select to authenticated using(exists(select 1 from public.documents d where d.id="documentId"));
drop policy read_authorized on public.document_comments;
create policy read_authorized on public.document_comments for select to authenticated using(exists(select 1 from public.documents d where d.id="documentId"));
-- Committee overrides remain private to that committee, including award criteria.
drop policy read_authorized on public.scoring_definitions;
create policy read_authorized on public.scoring_definitions for select to authenticated using (
 private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[])
 or (committee_id is null and exists(select 1 from public.user_access a where a.conference_id=scoring_definitions.conference_id and a.role='chair'))
);
drop policy read_authorized on public.award_criteria;
create policy read_authorized on public.award_criteria for select to authenticated using (
 private.has_access(conference_id,committee_id,array['admin','chair','observer']::public.conference_role[])
 or (committee_id is null and exists(select 1 from public.user_access a where a.conference_id=award_criteria.conference_id and a.role='chair'))
);
