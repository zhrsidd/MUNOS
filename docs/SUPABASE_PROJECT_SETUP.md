# New DCMUN Supabase project: setup plan (pre-migration)

Status 2026-10-20: **inspected only. No migration applied, no data written, no auth setting changed.**

## Identity

| | |
| --- | --- |
| Project ref | `kllhswucdhqqywnzxado` (`https://kllhswucdhqqywnzxado.supabase.co`) |
| Dashboard name | **DCMUN Staging** (see "Naming" below) |
| Organisation | Conference OS (`wenbceoykohowfzwhujs`), the only organisation and only project visible to the connector |
| Region / Postgres | ap-south-1 (Mumbai), Postgres 17.11, `ACTIVE_HEALTHY`, created 2026-10-20 12:06 UTC |
| Not PHESMUN | The PHESMUN production ref is `gglltljhdpkfjnyjmnif` (see `lib/platform/target-guard.ts` in PR #22). It is a different ref and was never contacted. |
| Not the deleted dev project | `opmydpozhdgkpcnjwpqb` is absent from the project list. |

Not verifiable through the connector: plan (Pro) and compute size (Micro). Confirm both in the dashboard. Upgrade to Small before 5 November.

**Naming:** the user brief says "DCMUN"; the dashboard says "DCMUN Staging". Because this one project is meant to become production, rename it in the dashboard (for example "DCMUN") before cutover so nobody treats it as disposable.

## Current state of the database

Empty: `list_migrations` returns none, no `public` tables, no `supabase_migrations` ledger yet, 0 auth users. Extensions: plpgsql, pg_stat_statements, uuid-ossp, pgcrypto, supabase_vault. Security advisor, two findings, both the same function:

* `public.rls_auto_enable()` (a platform helper, SECURITY DEFINER) is executable by `anon` and `authenticated` through `/rest/v1/rpc/rls_auto_enable`. Proposed fix, **needs approval**, as its own migration `20261020120000_revoke_rls_auto_enable.sql`:

  ```sql
  revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  ```

  If that function is an event-trigger helper owned by the platform it keeps working, because event triggers do not need caller EXECUTE. Re-run the advisor after applying.

## Migration plan (21 files, apply in this order, none applied)

Order is by filename timestamp. PR #22 (`codex/priority-chair-ui`, base `d651d97`) adds the last three and changes nothing else under `supabase/`. `main` and PR #22 have no overlapping migration timestamps, and the PR's three sort after everything on `main`.

| # | File | Source |
| --- | --- | --- |
| 1-18 | `20261005103403_conference_foundation` through `20261009120000_procedure_usability` (18 files, as listed in `supabase/migrations/`) | `main` |
| 19 | `20261019100000_approval_decisions` (adds `documents.review_round`, `document_decisions`, triggers; patches `operations_snapshot` in place) | PR #22 |
| 20 | `20261019100100_point_adjustments` (adds `participation_adjustments`; patches `apply_operations_mutation` and `operations_snapshot` in place) | PR #22 |
| 21 | `20261019100200_retire_archive_jobs` (**drops** `public.archive_jobs`; refuses if it has rows) | PR #22 |
| 22 | revoke `rls_auto_enable` (above) | proposed, optional |

Dependencies: 19-21 need `main`'s 18 first (they patch functions those create). The PR's `do $patch$` blocks fail closed if their anchor text changed. Apply 1-21 sequentially and in separate calls, so a failure stops at one known file. Migration 21 is destructive but safe on an empty database. PR #22 should merge to `main` before or together with the remote apply, so the repository and ledger stay in step.

### Dry run (done)

All 21 files were applied in order to a throwaway local PostgreSQL 16 with stub `auth`, `anon`, `authenticated` and `service_role`, and with Supabase-style default privileges (ALL on new public tables and functions granted to the API roles), so leaks would show. Result: zero errors, 35 public tables, `archive_jobs` dropped. The scratch cluster was deleted. This does not replace the real apply; it shows the ordering and the anchored patches are sound.

## Grants and RLS (from that dry run; recheck on the real project after apply)

* RLS enabled on every table in `public` and `private`.
* `anon`: no table privileges and no EXECUTE on any function in `public` or `private`.
* `authenticated`: SELECT only on tables (no INSERT/UPDATE/DELETE anywhere). Writes go through the `apply_*_mutation` and `redeem_access_code` family of RPCs.
* Public submission RPCs `submission_link_info`, `submit_resolution`, `amendment_link_info`, `submit_amendment` are executable by **`service_role` only**. Delegates reach them through the server routes holding `SUPABASE_SECRET_KEY`, so there is no direct anonymous RPC surface to widen. `/api/health` probes `submission_link_info` with the service key.
* `private` functions are executable by `authenticated` (Postgres default for functions). That is by design: RLS policies call `private.has_access`. Tables in `private` have deny-all policies.
* Anonymous sign-ins: **not verifiable from the connector** (no auth-config read, and testing would create an auth user). Confirm in Dashboard → Authentication → Sign In / Providers that *Allow anonymous sign-ins* is on, and review the per-IP anonymous rate limit. `supabase/config.toml` keeps it false for local only. After migration approval one test sign-in is enough to prove it.

## Test conference (after approval and apply)

One conference, minimal and clearly labelled, with a generated UUID (not the `seed.sql` demo id):

```sql
insert into public.conferences (name, venue, date, features, voting_rule)
values ('DCMUN Development Test', 'TEST DATA - not a real conference', '2026-11-05', '{}', 'simple_majority')
returning id;
```

Add one committee (`TST`) only if the app needs it to render. Its UUID goes in `NEXT_PUBLIC_CONFERENCE_ID`. No real conference data is imported. Executive access still needs the bootstrap in [FIRST_EXECUTIVE_BOOTSTRAP](FIRST_EXECUTIVE_BOOTSTRAP.md).

## References to the deleted project

`opmydpozhdgkpcnjwpqb` appears in three kinds of places.

1. **Live guards and config**: the `scripts/*.mts` guards, `KNOWN_DEVELOPMENT_REFS` in `lib/platform/target-guard.ts`, `docs/DEPLOYMENT.md`, `docs/STAGING_REHEARSAL.md`, `INTEGRATION.md`. **PR #22 already replaces the script guards with the env-driven target guard** (`STAGING_SUPABASE_REFS` / `DEVELOPMENT_SUPABASE_REFS` / `EXPECTED_SUPABASE_REF`). Editing those files here would only conflict with it. Do it as one follow-up commit **on top of PR #22 once merged**: change `KNOWN_DEVELOPMENT_REFS` to `[]` (fail closed rather than default to a deleted project), and update the three docs above.
2. **Historical evidence** (`docs/*-results.json`, `*_REPORT.md`, `VERIFICATION.md`, `INTEGRATION_REVIEW.md`, `FIRST_EXECUTIVE_BOOTSTRAP.md`): records of runs against the old project. Leave them unchanged, since rewriting them would falsify the record.
3. `supabase/config.toml` `project_id` is a stale local-CLI label, unrelated to the remote ref.

## Single-project cutover configuration

One project serves development now and production in early November, so the guard roles change at cutover (a ref may hold only one role).

| Phase | Where | Setting |
| --- | --- | --- |
| Development (now) | Operator shell / `.env.local`, Vercel **Preview** | `NEXT_PUBLIC_SUPABASE_URL=https://kllhswucdhqqywnzxado.supabase.co`, `STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado`, `DEVELOPMENT_SUPABASE_REFS=` (empty), `NEXT_PUBLIC_CONFERENCE_ID=<test uuid>`, `NEXT_PUBLIC_DATA_BACKEND=supabase` |
| Cutover | Vercel **Production** only | `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`; remove the ref from `STAGING_SUPABASE_REFS` everywhere; `NEXT_PUBLIC_CONFERENCE_ID` becomes the real conference id |

Cutover steps, each needing explicit approval: (1) delete the test conference and test auth users, and confirm no test data is left; (2) upgrade compute to Small; (3) confirm backups / PITR for the Pro plan; (4) rotate the secret key if it was ever used in a shared Preview; (5) set the Production variables above; (6) only then deploy the `production` branch. After step 1 the load, rehearsal and verification scripts refuse to run against the project, by design.

Keys: the publishable key goes in Vercel; `SUPABASE_SECRET_KEY` only as a Sensitive server variable. Neither is stored in the repository or in this document.

## Blockers and open decisions

1. Approval of the migration plan above (including whether to apply the optional #22 `rls_auto_enable` revoke).
2. PR #22 is open and unmerged; decide whether the remote is applied before or after it merges.
3. Confirm Pro plan, Micro compute and the anonymous sign-in setting in the dashboard.
4. Rename the dashboard project, or confirm "DCMUN Staging" is intended.
5. The Vercel project's Preview variables were not inspected or changed.
