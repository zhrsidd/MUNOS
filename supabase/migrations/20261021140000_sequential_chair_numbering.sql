-- Sequential resolution numbers for Chair-created drafts.
-- Until now a Chair-created draft (private.apply_mutation, command `newDocument`) was numbered
-- `<committee code> / <first 8 characters of the document id>` (for example `TST / ca7640bb`), while a public
-- submission (public.submit_resolution) was numbered sequentially per committee (`TST / 01`, `TST / 02`, ...). Both now
-- take their number from ONE helper, private.next_resolution_code, so the two paths cannot disagree or collide.
--
-- Additive: no table, column, constraint, policy or grant changes, and NO backfill. Existing rows are never renumbered;
-- a legacy `TST / ca7640bb` code stays valid, unique and displayed as it is. This migration is NOT applied to any hosted
-- project; it is replayed only by tests and, after review, by `supabase db push` to staging.
--
-- REVIEW NOTE FOR CODEX
-- Mechanism
--   private.next_resolution_code(conf, committee) returns `<committee code> / <NN>`:
--     NN = (highest existing sequential number in that committee) + 1, left-padded to two digits (`01`..`99`, then `100`).
--     "Sequential" means the code ends in ` / ` followed by 2-6 decimal digits. Legacy hex suffixes are exactly 8
--     characters, so they never match and the counter ignores them. The suffix is read, not the committee prefix, so a
--     committee renamed after its first resolution keeps counting.
--     After computing NN it still skips forward while a conference-wide document with that code exists (the same
--     defensive loop submit_resolution always had), so unique(conference_id, code) can never be hit by this path.
--   Old public rule was count(*)+1 + that loop. count(*) would count legacy hex drafts and leave gaps in `01..`, so
--   submit_resolution now also calls the helper (patched below). For committees with no legacy drafts the result is
--   identical to before (max+1 equals count+1 when numbers are 01..N).
-- Locking (unchanged ordering, nothing new to deadlock with)
--   Both callers already hold, before numbering, the per-request advisory lock (mutation id / submission id) and then
--   `select ... from public.committees where id = <committee> for update`. The helper takes that same committee row lock
--   itself (re-entrant in the same transaction), so numbering is serialized per committee whichever caller reaches it
--   first: Chair create vs Chair create, and Chair create vs public submission. Different committees do not block each
--   other. The helper adds no advisory lock and no new lock order.
-- Idempotency
--   apply_mutation checks the mutation receipt before numbering and returns early on a replay, so a retried mutation id
--   inserts nothing and consumes no number. submit_resolution replays by submission id the same way.
-- Uniqueness
--   Existing unique(conference_id, code) on public.documents is the backstop; no new constraint.
-- Functions
--   created: private.next_resolution_code(uuid,uuid)   SECURITY DEFINER, search_path='', EXECUTE revoked from public/anon/authenticated.
--   patched (create or replace via exact anchor, fails loudly unless it matches exactly once):
--     private.apply_mutation  newDocument code expression
--     public.submit_resolution  count(*)+1 / loop block
-- Rollback: a later forward migration restoring the previous bodies (git history of 20261006073442 and 20261006023111).
--   Documents numbered by this migration (`TST / 03`) stay valid either way.

create or replace function pg_temp.patch_once(definition text,anchor text,replacement text,label text) returns text language plpgsql as $$
begin
 if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception '% changed; review before applying',label; end if;
 return replace(definition,anchor,replacement);
end $$;

create function private.next_resolution_code(conf uuid,committee uuid) returns text language plpgsql security definer set search_path='' as $$
declare committee_code text; n integer; candidate text;
begin
 -- Same lock submit_resolution and apply_mutation take first; re-entrant, so calling after them costs nothing.
 select c.code into committee_code from public.committees c where c.id=committee and c.conference_id=conf for update;
 if committee_code is null then raise exception 'Committee unavailable' using errcode='22023'; end if;
 select coalesce(max((substring(d.code from ' / ([0-9]{2,6})$'))::integer),0)+1 into n
 from public.documents d where d.conference_id=conf and d.committee_id=committee and d.code ~ ' / [0-9]{2,6}$';
 loop
  candidate:=committee_code||' / '||lpad(n::text,2,'0');
  exit when not exists(select 1 from public.documents d where d.conference_id=conf and d.code=candidate);
  n:=n+1;
 end loop;
 return candidate;
end $$;
revoke all on function private.next_resolution_code(uuid,uuid) from public,anon,authenticated;

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 definition:=pg_temp.patch_once(definition,$q$c.code||' / '||substr(new_id::text,1,8),command->>'title' from public.committees c where c.id=cid;$q$,
  $q$private.next_resolution_code(conf,cid),command->>'title' from public.committees c where c.id=cid;$q$,'apply_mutation newDocument numbering anchor');
 execute definition;

 definition:=pg_get_functiondef('public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)'::regprocedure);
 definition:=pg_temp.patch_once(definition,$q$ select count(*) + 1 into n from public.documents where committee_id = link.committee_id;
 loop
   doc_code := committee_code || ' / ' || lpad(n::text, 2, '0');
   exit when not exists(select 1 from public.documents where conference_id = link.conference_id and code = doc_code);
   n := n + 1;
 end loop;
$q$,$q$ doc_code := private.next_resolution_code(link.conference_id, link.committee_id);
$q$,'submit_resolution numbering anchor');
 execute definition;
end $patch$;
