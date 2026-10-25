# Protected preproduction connection — 25 October 2026

The owner authorized Codex to take over safe work while Claude credits were unavailable and to connect the site if safe. This checkpoint connects synthetic-only preproduction, not the formal Production lifecycle phase.

## Source and verification

- PRs #67, #68 and #69 are merged after their fixes, independent re-review and green exact-head CI.
- PR #70 recovered HD10 and records the owner's choice: acknowledge an exact previously accepted action after revocation without another write; fresh actions remain denied.
- Merged main: `3e282f75faea255c998e3b4e4dbc4d4ccb8ba127`.
- Its tree is identical to reviewed/green head `652a05d42b4d6c604eea17de25eedd940bf95b8c`.
- Combined local verification: 823 tests passed, zero failures/skips/TODOs; typecheck/lint passed; application build passed using webpack (the temporary linked dependency directory was incompatible with Turbopack's symlink root check).
- GitHub CI on merged main passed: run [40190743174](https://github.com/zhrsidd/MUNOS/actions/runs/40190743174).

## Database

Only existing project `kllhswucdhqqywnzxado`, DCMUN Staging, PostgreSQL 17.11 was used. It contains the three previously labelled test conferences; the selected fixture has TEST Delegate A/France, TEST Delegate B/Japan and TEST resolution TST / 01. No real conference was created or promoted.

Applied exact committed sources:
- `20261021140000_sequential_chair_numbering.sql`
- `20261022090000_privilege_hardening.sql`

Both were first executed in one rollback rehearsal ending in the deliberate MUNOS_PREPRODUCTION_MIGRATIONS_VERIFIED_AND_ROLLED_BACK exception. A separate read proved the original function digests, 26-row ledger and absent helper were unchanged.

The management connector assigned execution-time migration versions. Each was reconciled immediately to its repository version with a guard requiring the exact generated version/name, expected total ledger count, absent repository version and exact one-statement source equality. Statements and other metadata were preserved:
- `20261025115511` → `20261021140000`
- `20261025115531` → `20261022090000`

Independent post-check: 28 ledger rows; numbering helper present; zero remaining removed privileges across the three API roles; authenticated SELECT on all 36 public tables; anon executes zero public/private functions; service-role EXECUTE remains exactly submission_link_info, amendment_link_info, submit_resolution and submit_amendment.

No cleanup deletion, compute upgrade, spending, version bump or tag occurred.

## Connected deployment inventory

| Field | Value |
| --- | --- |
| Vercel project | munos / prj_Z0vU5UcL5sGhvDIbKzb3rnfzsQyp |
| Deployment | dpl_F9e5BBiNSpmRUoW4wAT4ayYzLzvC |
| Immutable URL | https://munos-pkwytp1dc-dcmun.vercel.app |
| Dedicated branch | codex/preproduction-connected |
| Branch URL | https://munos-git-codex-preproduction-connected-dcmun.vercel.app |
| Commit | 3e282f75faea255c998e3b4e4dbc4d4ccb8ba127 |
| Database phase | Development / preproduction |
| Conference | 0331ceb6-3fa8-4731-92cb-2b4c0316d0cb |
| Protection | Vercel Authentication, all deployments |
| Unauthenticated proof | 302 redirect to Vercel SSO |
| Backend | supabase, scoped to this Preview branch only |
| Server key | Not installed; QR submissions unavailable |

Branch-specific Preview variables: NEXT_PUBLIC_DATA_BACKEND, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_CONFERENCE_ID, STAGING_SUPABASE_REFS and NEXT_PUBLIC_ENABLE_ANONYMOUS_BOOTSTRAP. No EXPECTED_SUPABASE_REF or DEVELOPMENT_SUPABASE_REFS was installed. Production and ordinary Preview keep NEXT_PUBLIC_DATA_BACKEND=local.

The Vercel API's legacy staging target automatically moved secondary alias munos-dcmun.vercel.app to this deployment. This was detected and immediately restored to Production demo deployment dpl_3WvVFTc6A5CdAr5LmyDe8Gyk7Xad. munos-tau.vercel.app was unchanged. Both were independently checked after restoration. Future connected deployments must check this alias behavior again.

## Functional database proof

Using the app's real redeemStaffCode and SupabaseTransport against the allowed fixture:
- Executive and Chair signed in through normal anonymous-device/access-code redemption.
- Executive and Chair snapshots read successfully.
- A labelled TEST school was saved, its exact mutation replayed and a fresh Executive device read the saved row.
- Changed payload reuse and a Chair attempting an Executive command were denied.
- Independent SQL proved exactly one saved school and one receipt for mutation `32187d98-daeb-49cd-95fe-ca4cccf0bec0`, with neither denied school present.
- Three short-lived synthetic device grants remain. Bootstrap was rotated into a normal Executive code. Test Executive/Chair codes expire 26 October 2026 at 12:03 UTC (15:03 Qatar); they are stored only in an ignored, mode-0600 local file. No code/token/key appears in this record.

## Outstanding verification and release gates

The owner completed the Vercel team authorization. Authenticated fetches of the immutable deployment's root and /api/health now return HTTP 200. Health identifies the exact reviewed commit 3e282f75faea255c998e3b4e4dbc4d4ccb8ba127, the dedicated branch and Preview environment; its Supabase check reports ok. The deployed browser reaches the staff access-code form through the connector's existing, expiring deployment share link. Deployment protection remains enabled.

No server secret was installed, so public QR routes and server database/Storage health probes remain unavailable. Staff data flow was verified through the real client/transport, not through the deployed browser UI. Browser reload/offline/two-device conflict behavior, hosted revocation of sessions/tokens, public submission flow, load/capacity and formal release acceptance remain separate gates.

Production is still demo on commit `542e7052b75b1bb4d8fa842add2d8ddd1f9fd2a6`. This checkpoint is not Production promotion or conference readiness approval.

## Retirement before cutover

Stop branch-connected builds; remove branch-scoped settings; delete this immutable connected deployment and its branch alias; revoke synthetic credentials/device grants; inventory any later connected deployment separately. Changing variables alone does not disconnect an immutable deployment. If a server key is installed later, record it and rotate it at cutover. Do not execute destructive cleanup without its separate guarded run approval.
