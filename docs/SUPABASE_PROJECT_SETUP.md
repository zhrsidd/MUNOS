# New DCMUN Supabase project: setup record

Status 2026-10-20: **all 21 migrations applied and verified; test conference created; development role.** Not yet production. See [Single-project cutover](DEPLOYMENT.md#single-project-cutover) for the move to production.

## Identity

| | |
| --- | --- |
| Project ref | `kllhswucdhqqywnzxado` (`https://kllhswucdhqqywnzxado.supabase.co`) |
| Dashboard name | **DCMUN Staging** (see "Naming" below) |
| Organisation | Conference OS (`wenbceoykohowfzwhujs`), the only organisation and only project visible to the connector |
| Region / Postgres | ap-south-1 (Mumbai), Postgres 17.11, `ACTIVE_HEALTHY`, created 2026-10-20 12:06 UTC |
| Not PHESMUN | The PHESMUN production ref is `gglltljhdpkfjnyjmnif` (`lib/platform/target-guard.ts`). It is a different ref and was never contacted. |
| Not the deleted dev project | `opmydpozhdgkpcnjwpqb` is absent from the project list. |
| Test conference | `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb` ("DCMUN Development Test", venue "TEST DATA - not a real conference") = `NEXT_PUBLIC_CONFERENCE_ID` during the development role |

Not verifiable through the connector: plan (Pro) and compute size (Micro). Confirm both in the dashboard. Upgrade to Small before 5 November.

**Naming:** the dashboard says "DCMUN Staging". Because this one project becomes production, rename it in the dashboard (for example "DCMUN") before cutover so nobody treats it as disposable.

## Migrations (applied)

PR #22 merged to `main` (`852642c`) before the apply. The 21 files on `main` were compared byte for byte with the reviewed copies, then applied in filename order by the owner with the Supabase CLI (`supabase db push`). An earlier attempt through the Supabase MCP connector timed out at its 60-second limit on the 55 KB foundation file and changed nothing; files were not split and the ledger was not edited by hand.

| # | File |
| --- | --- |
| 1-18 | `20261005103403_conference_foundation` through `20261009120000_procedure_usability` |
| 19 | `20261019100000_approval_decisions` |
| 20 | `20261019100100_point_adjustments` |
| 21 | `20261019100200_retire_archive_jobs` (dropped `public.archive_jobs`) |

The ledger (`supabase_migrations.schema_migrations`) has exactly these 21 rows, with versions and names equal to the filenames.

## Verification against the live project

**Schema fingerprint.** The same 21 files were rebuilt on a throwaway local PostgreSQL and fingerprinted (md5 over sorted catalogue definitions). Live result: identical for columns (402), constraints (291), indexes (260), policies (41), RLS flags (41), function definitions (46), triggers (5), enums (4) and the view.

**RLS and grants.**

* RLS on every table in `public` and `private` (41).
* `anon`: no table privileges, no EXECUTE on any function in `public` or `private`; no USAGE on `private`.
* `authenticated`: SELECT only on 36 relations (35 tables and `participation_history`). Writes only through RPCs.
* `service_role`: EXECUTE on exactly `submission_link_info`, `submit_resolution`, `amendment_link_info`, `submit_amendment`. No table SELECT/INSERT/UPDATE/DELETE (see below).
* `public.rls_auto_enable()` (platform helper, SECURITY DEFINER): ACL `{postgres=X/postgres}`; `anon` and `authenticated` cannot execute it (live call: 401). Not changed by us; the proposed revoke migration is deferred to Codex review and may be unnecessary.

**Service-role grants (explained).** This project's platform default ACL for tables created by `postgres` in `public` is `anon/authenticated/service_role = Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN only). The migrations revoke everything from `anon` and `authenticated`, then grant `authenticated` SELECT, so `service_role` keeps only those defaults. The application's server code reaches the database only through SECURITY DEFINER RPCs and the Storage API, so nothing needs table grants. `service_role` still holds TRUNCATE on public tables; the key is server-only and PostgREST does not expose TRUNCATE.

**Behaviour (HTTP, publishable key).**

| Caller | Result |
| --- | --- |
| No session | Table reads and every RPC: 401 permission denied |
| Anonymous sign-in | Works (anonymous sign-ins are enabled) |
| Anonymous session, no grant | Reads empty; insert 403; `submission_link_info` 403; `conference_snapshot`, `apply_conference_mutation`, `access_code_status` 403; `redeem_access_code` with a wrong code: `{"status":"invalid"}` |

**Server submission path (as `service_role`, in the database).** `submission_link_info` returns the TEST link with its two submitters; a bad token returns null; `submit_resolution` created `TST / 01`; an identical replay returned `replayed`. The full HTTP path through `/api/submissions` needs `SUPABASE_SECRET_KEY` (see blockers).

**Smoke test (`npm run smoke:project`, PR #26).** 15/15 through the app's own client code: Executive bootstrap redemption, minimal TEST committee, idempotent replay, Chair redemption and operations, stale-edit conflict, role boundaries, submission link, Executive rotation.

**Security advisors.** Four warnings that `access_code_status`, `redeem_access_code`, `rotate_access_code` and `revoke_access_code` are SECURITY DEFINER and callable by `authenticated`: by design, each checks access itself (verified above). About 35 "anonymous access policy" warnings on the `to authenticated` read policies: anonymous sign-ins have the `authenticated` role, and every policy requires a `user_access` grant.

## Test data on the project

All clearly labelled; delete at cutover.

* Conference `DCMUN Development Test`.
* Committee `TST` (`8334a808-1bc9-4ff4-b2ac-000000000001`), "TEST School (not real)" plus smoke-test replay schools, two delegates `TEST Delegate A/B` (`@example.com`), session `fdcb12cf-3a74-461c-98f2-000000000001`, attendance, one queue entry, one submission link, resolution `TST / 01`.
* Anonymous auth users from the tests, and their `user_access` grants.
* Access codes: one active Executive code (created by a smoke-test device, value not recorded) and one Chair code for `TST`; the bootstrap and earlier test codes are revoked.

## References to the deleted project

* Live guard and docs: removed in PR #25 (`KNOWN_DEVELOPMENT_REFS` deleted; no implicit development project). Needs Codex review before merging.
* Historical evidence (`docs/*-results.json`, `*_REPORT.md`, `VERIFICATION.md`, `INTEGRATION_REVIEW.md`, `FIRST_EXECUTIVE_BOOTSTRAP.md`) is left unchanged on purpose.
* `supabase/config.toml` `project_id` is a stale local-CLI label, unrelated to the remote ref.

## Single-project configuration

| Phase | Where | Setting |
| --- | --- | --- |
| Development (now) | Operator shell / `.env.local`, Vercel **Preview** | `NEXT_PUBLIC_SUPABASE_URL=https://kllhswucdhqqywnzxado.supabase.co`, `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado`, `DEVELOPMENT_SUPABASE_REFS=` (empty), `NEXT_PUBLIC_CONFERENCE_ID=0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`, `NEXT_PUBLIC_DATA_BACKEND=supabase` |
| Cutover | Vercel **Production** only | `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`; remove the ref from `STAGING_SUPABASE_REFS` everywhere; `NEXT_PUBLIC_CONFERENCE_ID` becomes the real conference id |

Keys: the publishable key goes in Vercel; `SUPABASE_SECRET_KEY` only as a Sensitive server variable. Neither is stored in the repository or in this document.

## Open items

1. HTTP test of `/api/submissions` and `/api/amendments` with `SUPABASE_SECRET_KEY` (not available to this session).
2. Codex review of PR #25 (target guard) and of `rls_auto_enable()` before any 22nd migration.
3. Confirm Pro plan, Micro compute, and rename the dashboard project.
4. Vercel Preview variables not inspected or changed.
