-- MUNOS — one-time FIRST EXECUTIVE bootstrap for a brand-new conference project.
--
-- Why: Executive access codes are issued by an Executive (Executive → Access codes). A brand-new
-- project has no Executive yet. This script creates ONE short-lived Executive access code out of
-- band, using exactly the format, hashing and table the app's rotate_access_code RPC uses. The
-- first Executive redeems it in the normal app (staff access-code gate), which creates the normal
-- anonymous device identity and public.user_access grant. That Executive then immediately creates
-- a normal Executive code in the app (Access codes → Executive → Create/Rotate), which retires this
-- bootstrap code automatically. No second authentication system, no direct grant insertion.
--
-- How to run (operator with database access, e.g. Supabase dashboard → SQL Editor of the INTENDED
-- project — check the project name first):
--   1. Edit the two values marked EDIT below.
--   2. Run the WHOLE script at once (one transaction). The last result row shows the code ONCE.
--      Copy it into the password manager / hand it to the first Executive in person.
--      It is not stored anywhere: only its SHA-256 digest is saved, the raw value lives only in a
--      transaction-local setting that disappears at commit, and nothing is written to audit_log.
--   3. Do NOT save this query with the result, screenshot the result, or paste the code in chat.
--
-- Safety:
--   * Refuses to run if the conference does not exist, if ANY unrevoked Executive credential
--     already exists for it (it never replaces one; the database's one-active-scope index enforces
--     the same), or if the validity is outside 10 minutes – 24 hours.
--   * created_by stays NULL (out-of-band bootstrap; there is no Executive identity yet).
--   * If the code is lost before use, revoke it (section C) and run this script again.

select set_config('munos.bootstrap_conference', '00000000-0000-0000-0000-000000000000', true);  -- EDIT 1: conference UUID
select set_config('munos.bootstrap_valid_for',  '2 hours',                              true);  -- EDIT 2: 10 minutes … 24 hours

do $$
declare
  conf uuid := nullif(current_setting('munos.bootstrap_conference', true), '')::uuid;
  valid_for interval := nullif(current_setting('munos.bootstrap_valid_for', true), '')::interval;
  raw text;
  formatted text;
begin
  if conf is null or valid_for is null then
    raise exception 'Bootstrap settings missing: run the whole script at once in one transaction.';
  end if;
  if not exists (select 1 from public.conferences c where c.id = conf) then
    raise exception 'Conference % does not exist in this project. Check the UUID and the project.', conf;
  end if;
  if valid_for < interval '10 minutes' or valid_for > interval '24 hours' then
    raise exception 'Validity % refused: use between 10 minutes and 24 hours.', valid_for;
  end if;
  if exists (
    select 1 from private.access_credentials a
    where a.conference_id = conf and a.role = 'admin' and a.committee_id is null and a.revoked_at is null
  ) then
    raise exception 'An unrevoked Executive credential already exists for this conference. Bootstrap refused: an Executive should issue codes in the app. If it is a lost bootstrap code, revoke it first (section C).';
  end if;

  -- Same generation, normalisation and digest as public.rotate_access_code / redeem_access_code:
  -- 24 upper-case hex characters from database randomness, SHA-256 of the unformatted value.
  raw := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
  formatted := substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||
               substr(raw,13,4)||'-'||substr(raw,17,4)||'-'||substr(raw,21,4);

  insert into private.access_credentials (conference_id, committee_id, role, credential_hash, expires_at, created_by)
  values (conf, null, 'admin', encode(sha256(convert_to(raw, 'UTF8')), 'hex'), now() + valid_for, null);

  perform set_config('munos.bootstrap_code', formatted, true);  -- transaction-local; gone at commit
end $$;

select current_setting('munos.bootstrap_code') as executive_bootstrap_code_shown_once,
       a.id as credential_id, a.expires_at
from private.access_credentials a
where a.conference_id = current_setting('munos.bootstrap_conference')::uuid
  and a.role = 'admin' and a.committee_id is null and a.revoked_at is null;

-- ---------------------------------------------------------------------------------------------
-- B. CHECK (run separately, any time; shows no code or digest):
-- select id, role, committee_id, created_by, expires_at, revoked_at, created_at
-- from private.access_credentials
-- where conference_id = '<conference-uuid>' and role = 'admin' order by created_at;
--
-- After the first Executive has signed in and created a normal Executive code in the app, the
-- bootstrap row (created_by NULL) must show revoked_at set — rotation revokes it automatically.
--
-- C. REVOKE an unused/lost bootstrap code (run separately; keeps devices already prepared):
-- update private.access_credentials set revoked_at = now(), updated_at = now()
-- where conference_id = '<conference-uuid>' and role = 'admin' and committee_id is null
--   and created_by is null and revoked_at is null;
