-- Defense in depth only: browser table privileges remain revoked.
create policy no_browser_access on private.amendment_submissions
 for all to anon, authenticated using (false) with check (false);

-- Cover the reported foreign keys in their declared column order.
-- Retain existing indexes; no index consolidation in this migration.
create index access_credentials_created_by_idx on private.access_credentials(created_by);
create index access_redemption_attempts_conference_id_idx on private.access_redemption_attempts(conference_id);
create index amendment_links_committee_conference_idx on public.amendment_links(committee_id, conference_id);
create index amendments_committee_conference_idx on public.amendments(committee_id, conference_id);
create index amendments_resolution_conference_committee_idx on public.amendments("resolutionId", conference_id, committee_id);
create index amendments_session_conference_committee_idx on public.amendments("sessionId", conference_id, committee_id);
create index amendments_submitter_conference_committee_idx on public.amendments("submitterId", conference_id, committee_id);
create index sessions_slot_conference_idx on public.sessions("slotId", conference_id);
