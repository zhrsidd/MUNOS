# Cutover verification · 1 November 2026

**Preparation complete to the recorded human gates; production promotion is not approved or performed.** The project is still preproduction, Production remains demo, and no real conference exists. The owner chose PITR off with daily backups. Use the [human handover](../../cutover/2026-11-01/README.md).

## Reviewed source and local checks

Application candidate `032daa5864a38b377b0df96f20939512b554fcd7`; main at task start `48a836fe84bc32d36bc01cba5a60a4d6090c73c5` adds documentation only. This preparation branch adds a capacity-evaluator correction, a forward SQL fix and handover material. The final production registry change is an unapplied patch and needs its own approval.

- Full suite on disposable PostgreSQL **17.11**: **1,013 passed, zero failed, zero skipped**, including 4,100 authorisation matrix cells. The full run followed the SQL fix.
- Application and rehearsal typechecks, lint and production build passed. No application TypeScript/TSX was changed by the SQL fix after the build.
- `npm run check:grants` on PostgreSQL 17 passed: generated inventory current, zero privilege-policy violations.
- Independent amendment regression run: 19 passed, zero failed/skipped, including native PostgreSQL and upgrade owner/OID/ACL preservation.
- Capacity evaluator regression: 21 tests passed; it now checks current `rollCallCommit` samples as well as legacy `rollCall` samples. H3's roll-call p95 is 166 ms and its recomputed runner verdict stays PASS. See [CAPACITY_REVIEW.md](CAPACITY_REVIEW.md) for remaining operator evidence.

## Hosted fix and browser checks

A fresh, synthetic fixture `2067d8be-48cb-4b55-a139-3c8be42b4c51` was independently reviewed before creation. No existing conference was edited by the browser workflows.

The real browser check found `public.amendment_link_info(text)` still filtering by the retired selected-session pointer, so a valid committee amendment link incorrectly showed debate closed. Forward migration `20261101100000_amendment_link_committee_scope.sql` removes that predicate while preserving the projection, lifecycle/revocation/archive filters and service-role-only execute permission. The migration and tests were authored by a second engineer and independently read and tested by the primary reviewer.

The CLI dry run identified only this migration, but two apply attempts stalled at login-role initialisation. A subsequent live check confirmed the migration had been applied: **38 ledger entries**, latest `20261101100000`, no legacy session predicate, `anon`/`authenticated` execute false and `service_role` execute true. The successful apply operator was not established by this verification; no manual ledger rewriting was used.

| Evidence | Scope and result |
| --- | --- |
| [browser-report.json](browser-report.json) | Locally built production-mode browser client → real synthetic Supabase: channels joined; cross-browser roll call delivered by real Postgres Changes; ballot eligibility frozen; offline points survived reload and applied once; blocked Realtime did not stop core writes; recovery reconnected; keyboard speaker selection worked; no uncaught page errors. This is not deployed-Vercel or venue evidence. |
| [role-report.json](role-report.json) | Same client/project: Chair resubmit → Approval feedback and history → printing status round trip; inline Chair feedback visible; no page errors. |
| [public-report.json](public-report.json) | Exact H3 Preview `dpl_AgKbB2jJNzS3hpnMhvPCS63JNmwg`, source `032daa5`: resolution form, PDF-link rejection before POST, valid amendment form all passed after migration. Protected Preview accessed through temporary Vercel sharing; no real document/amendment submitted and no unauthenticated phone proof. A stale test heading selector was corrected to the actual amendment form field. |
| [revocation-report.json](revocation-report.json) | Original synthetic actor, authenticated token with 3,600 seconds remaining: fresh reads hidden, fresh write refused, saved action retained/exportable in the durable outbox. Auth global sign-out followed. This proves grant revocation rather than token expiry. |
| [operator-sql-report.json](operator-sql-report.json) | Prepared human SQL exercised on disposable local PGlite only: nine scope/order/idempotency/creation checks passed. No hosted cleanup, promotion or real conference creation performed. Independent human review is still required before execution. |
| [session-retirement-report.json](session-retirement-report.json) | Nine locally retained synthetic identities: eight global sign-outs; one already unavailable; zero sign-out errors. This does not establish global Auth retirement. |

## Final hosted inventory

Read at `2026-11-01T09:36:19Z`: correct project `kllhswucdhqqywnzxado`, phase preproduction, revision 1, `canTest=true`; ten synthetic conferences, zero real conferences and zero live grants. The new fixture has **zero unrevoked grants, codes, resolution links or amendment links**, verified after the reviewed fixture-only retirement transaction committed.

Remaining global authority at that reading: **13 unrevoked but expired grants, six unrevoked but expired codes and two old unrevoked resolution links**. These belong to the original synthetic inventory and remain for the human cutover transaction. Later Auth inventory: **175 users, 147 sessions**; supported global administrative retirement is still required. No Auth users were deleted.

The original development conference retained **24 operational changes, one document and 30 audit rows**, matching the earlier counts. No synthetic conferences were deleted. The reserved real UUID remains uncreated.

Vercel metadata rechecked at the end: `munos` still has Vercel Authentication on **all** deployments, and Production has no Supabase URL, publishable key, conference UUID or expected-project-ref configuration. Public Production access and the real database connection are therefore not configured. No Vercel configuration was changed.

The last possible local test refresh was `2026-11-01T09:36:52.662Z`; all retained test identities were then signed out. This is **not** the global token-issuance cutoff: legacy/other sessions and agent management access remain. The 3,600-second global wait has not started.

## Hosted H3 log recovery

The exact-window re-query now returns 2,072 staff write log rows (all HTTP 204) and 16 public submissions (all HTTP 200), matching the runner aggregates. The earlier 45-row difference is superseded. There are 2,071 distinct staff request IDs, with one repeated ID; individual correspondence is not established. See [h3-log-requery.json](h3-log-requery.json) and the updated capacity review. This does not recover the missing resource-monitoring evidence or supply final release acceptance.

## Still open before promotion

- Human capacity-evidence decisions, including missing watcher IO/swap/cadence evidence and the bounded request-ID correlation limitation; final independent acceptance and John Paul Ribeiru's exact-SHA release sign-off.
- Independent review of the prepared human scripts, deliberate owner scope approval for all-ten-conference cleanup, current backup evidence and guarded cleanup/Storage/Auth retirement.
- Retirement of seven known connected Previews, their sharing access and any newer connected builds; global test Auth and credential retirement; connector disconnection; token wait.
- Separate approved production registry commit, lifecycle marker promotion, new Production-only configuration/credentials, public Production protection setting, compatible credential-rotated rollback deployment and non-destructive deployment verification.
- Human creation/bootstrap of the protected real conference and normal-phone view-only verification of the resulting real QR forms.

Do not describe the runner PASS, these browser checks, or a green build as final production GO. After promotion, agents may review source and run local synthetic checks only.
