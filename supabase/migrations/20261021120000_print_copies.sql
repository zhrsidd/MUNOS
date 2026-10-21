-- Print copies follow committee size (audit F3; ported from PHESMUN 20261010200000 as a new DCMUN migration).
-- Each time a resolution enters Approved (the Admins' print queue), including re-approval after changes, its copy count
-- becomes the number of delegates in its committee plus 3 spares (Chairs and the Approval Panel). Until now every
-- resolution kept the column default of 24 whatever the committee size.
-- Admins (logistics) cannot read delegates under RLS, so the count is taken here and they see only the number.
-- Mirrored in lib/print.ts. No RLS, grants or mutation functions change.
create function private.print_copies(conf uuid,cid uuid) returns integer language sql stable security definer set search_path='' as $$
 select least(10000,(select count(*) from public.delegates where conference_id=conf and committee_id=cid)::integer+3) $$;
revoke all on function private.print_copies(uuid,uuid) from public,anon,authenticated;

create function private.set_print_copies() returns trigger language plpgsql security definer set search_path='' as $$
begin
 new.copies:=private.print_copies(new.conference_id,new.committee_id);
 return new;
end $$;
revoke all on function private.set_print_copies() from public,anon,authenticated;

create trigger documents_print_copies before insert or update of status on public.documents
 for each row when (new.status='Approved') execute function private.set_print_copies();

-- Existing records: resolutions waiting in the print queue (Approved, not yet printed) are recounted so the queue is
-- right. Printed, In Debate and Closed resolutions keep the count they were printed with (history is not rewritten).
-- A recount is a change to the document like any other: only rows whose number actually changes are updated, and each
-- advances revision and updated_at as private.apply_mutation does and emits the same committee-scoped 'documents'
-- notification, so open devices refresh and a Printed queued offline against the old quantity is rejected as stale
-- (PT409) instead of being applied. Committee rows are locked first, in id order, as apply_mutation locks its committee
-- before checking the expected revision, so no mutation can check a revision this update is about to change.
-- The update does not set status, so neither this trigger nor the status triggers fire. No audit_log row: it needs an
-- actor and this is a migration, not a person.
do $$ begin
 perform 1 from public.committees where id in (select committee_id from public.documents where status='Approved') order by id for update;
 with recount as (
  update public.documents set copies=private.print_copies(conference_id,committee_id),revision=revision+1,updated_at=now()
   where status='Approved' and copies<>private.print_copies(conference_id,committee_id)
   returning conference_id,committee_id)
 insert into public.operational_changes(conference_id,committee_id,topic,mutation_id)
  select conference_id,committee_id,'documents',gen_random_uuid() from recount;
end $$;
