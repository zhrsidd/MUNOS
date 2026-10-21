-- Resolution identity projection: publish the Main Submitter's COUNTRY (nothing else about the delegate) to the roles
-- that cannot read public.delegates, so `GA1/01 — France` resolves in hosted mode. Additive: no table, policy, grant
-- or RLS change; no backfill.
--
-- REVIEW NOTE FOR CODEX
-- Why: public.delegates is readable only by admin/chair/observer, so the Approval Panel and Logistics snapshots carry no
-- delegates, and the public amendment page never learned the resolution's submitter. Their screens would read
-- `GA1/01 — Main submitter unavailable`.
--
-- Functions created
--   private.submitter_country(conf, committee, delegate)  SECURITY DEFINER, search_path=''. Returns ONLY delegates.country
--       (never name, email, school, flag), and null unless the delegate is in that conference AND committee.
--       EXECUTE revoked from public, anon and authenticated: it is not an RPC and is reachable only from the two
--       definer projections below (which run as their owner).
--   private.document_submitter_countries(conf)  SECURITY DEFINER, search_path=''. Returns {documentId: country}.
--       Granted to authenticated like private.decision_history (conference_snapshot is SECURITY INVOKER, so it needs
--       it). It repeats the documents SELECT policy exactly: chair/admin/observer see every document in their scope;
--       approval sees Submitted/Review/Approved; logistics sees Approved/Printed/In Debate/Closed; all under
--       private.has_access (conference, committee scope, revocation, expiry). A document the caller cannot read is
--       never in the map. conference_snapshot only looks entries up for document rows it already returns under RLS, so
--       even a future policy change can only remove countries, never add them.
--
-- Functions patched (create or replace, exact anchor that must match once; the migration fails loudly otherwise)
--   public.conference_snapshot(uuid)   documents[].submitterCountry (null when the caller has no entry); the map is built once.
--   private.decision_history(uuid)     entries[].submitterCountry, in both the decision rows and the legacy comment
--                                      rows. Same access as before (approval/chair/admin/observer under has_access), so
--                                      history for a document that has since left the reader's view still resolves.
--   public.amendment_link_info(text)   resolution.submitterId. Token-gated, service_role only; the delegate list in the
--                                      same payload was already public, so this discloses no new fact class.
--   public.executive_snapshot(uuid)   documents[].submitterCountry, same lookup, so the Executive documents projection stays
--                                      identical to conference_snapshot's (the Executive can read delegates anyway).
-- Not patched: operations_snapshot (it already publishes documentDecisions through private.decision_history).

create or replace function pg_temp.patch_once(definition text,anchor text,replacement text,label text) returns text language plpgsql as $$
begin
 if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception '% changed; review before applying',label; end if;
 return replace(definition,anchor,replacement);
end $$;

create function private.submitter_country(conf uuid,committee uuid,delegate uuid) returns text language sql stable security definer set search_path='' as $$
 select nullif(btrim(d.country),'') from public.delegates d where d.id=delegate and d.conference_id=conf and d.committee_id=committee $$;
revoke all on function private.submitter_country(uuid,uuid,uuid) from public,anon,authenticated;

create function private.document_submitter_countries(conf uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(d.id,c.country),'{}'::jsonb)
 from public.documents d cross join lateral (select private.submitter_country(d.conference_id,d.committee_id,d."submitterId") country) c
 where d.conference_id=conf and c.country is not null and (
  private.has_access(d.conference_id,d.committee_id,array['chair','admin','observer']::public.conference_role[])
  or (d.status in ('Submitted','Review','Approved') and private.has_access(d.conference_id,d.committee_id,array['approval']::public.conference_role[]))
  or (d.status in ('Approved','Printed','In Debate','Closed') and private.has_access(d.conference_id,d.committee_id,array['logistics']::public.conference_role[]))
 ) $$;
revoke all on function private.document_submitter_countries(uuid) from public,anon;
grant execute on function private.document_submitter_countries(uuid) to authenticated;

do $patch$
declare definition text;
begin
 -- Documents projection. The country map is built once per snapshot (not per document) and looked up by id.
 definition:=pg_get_functiondef('public.conference_snapshot(uuid)'::regprocedure);
 definition:=pg_temp.patch_once(definition,$q$declare result jsonb;$q$,$q$declare result jsonb; countries jsonb;$q$,'conference_snapshot declare anchor');
 definition:=pg_temp.patch_once(definition,$q$ select jsonb_build_object($q$,$q$ countries:=private.document_submitter_countries(conf);
 select jsonb_build_object($q$,'conference_snapshot select anchor');
 definition:=pg_temp.patch_once(definition,
  $q$'committeeId',committee_id,'versionIds',$q$,
  $q$'committeeId',committee_id,'submitterCountry',countries->>x.id::text,'versionIds',$q$,'conference_snapshot documents anchor');
 execute definition;

 -- Executive snapshot: same documents projection, so it stays identical to the core snapshot's (the Executive reads
 -- delegates anyway; the country only keeps the two shapes, and their parity test, in step).
 definition:=pg_get_functiondef('public.executive_snapshot(uuid)'::regprocedure);
 definition:=pg_temp.patch_once(definition,E'AS $function$\nbegin\n',E'AS $function$\ndeclare countries jsonb;\nbegin\n','executive_snapshot declare anchor');
 definition:=pg_temp.patch_once(definition,E' return jsonb_build_object(\n',E' countries:=private.document_submitter_countries(conf);\n return jsonb_build_object(\n','executive_snapshot return anchor');
 definition:=pg_temp.patch_once(definition,
  $q$'committeeId',committee_id,'versionIds',$q$,
  $q$'committeeId',committee_id,'submitterCountry',countries->>x.id::text,'versionIds',$q$,'executive_snapshot documents anchor');
 execute definition;

 -- Decision history: the country rides on the same row and the same has_access check as the rest of the entry.
 definition:=pg_get_functiondef('private.decision_history(uuid)'::regprocedure);
 definition:=pg_temp.patch_once(definition,
  $q$'decision',d.decision,'round',d.round,$q$,
  $q$'submitterCountry',private.submitter_country(x.conference_id,x.committee_id,x."submitterId"),'decision',d.decision,'round',d.round,$q$,'decision_history decision anchor');
 definition:=pg_temp.patch_once(definition,
  $q$'decision','comment','round',0,$q$,
  $q$'submitterCountry',private.submitter_country(x.conference_id,x.committee_id,x."submitterId"),'decision','comment','round',0,$q$,'decision_history comment anchor');
 execute definition;

 -- Public amendment page: the current resolution's submitter id (the delegate list beside it is already public).
 definition:=pg_get_functiondef('public.amendment_link_info(text)'::regprocedure);
 definition:=pg_temp.patch_once(definition,
  $q$jsonb_build_object('id',d.id,'code',d.code,'title',d.title)$q$,
  $q$jsonb_build_object('id',d.id,'code',d.code,'title',d.title,'submitterId',d."submitterId")$q$,'amendment_link_info resolution anchor');
 execute definition;
end $patch$;
