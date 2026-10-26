# Pre-cutover verification — 26 October 2026

**The protected Preview is Supabase-connected; Production remains demo.** No promotion or real-data entry occurred. The paid Small upgrade and full load window remain 31 October.

## Exact candidate and environment

- App candidate: `4db21e590696fc8a5152507551568927ef06a030`. GitHub CI [40251649398](https://github.com/zhrsidd/MUNOS/actions/runs/40251649398) passed; independent protected-area review approved this exact commit.
- Protected Preview: https://munos-7hptv216n-dcmun.vercel.app, deployment `dpl_EQboPWUsbX4MfMGYYxekPJ8p1JPu`, branch `codex/preproduction-connected`, actual environment Preview, target `null`. Authenticated health: HTTP 200; Supabase, database and Storage all `ok`. Temporary verification sharing was revoked.
- Both Production aliases still point to `dpl_3WvVFTc6A5CdAr5LmyDe8Gyk7Xad`, commit `542e7052b75b1bb4d8fa842add2d8ddd1f9fd2a6`, the earlier demo build.
- Single hosted project: `kllhswucdhqqywnzxado`, PostgreSQL 17.11. The marker reports `preproduction`, revision 1, `canTest=true`. It has not been promoted.

## Migration and permission proof

`20261026003647_lifecycle_controls.sql` was applied only after local replay, 841 passing tests (zero skips/failures), typecheck, lint, webpack build, grants inventory/check, independent review and CI passed. The connector assigned version `20261026075051`; a guarded ledger-only reconciliation changed it to the committed version after matching the entire stored source exactly (MD5 `611766e879c39b21b4e05ea3f9c8bdc9`; SHA-256 `d5cad3dba472bb77f623d9ee5296218de0b19afbfe24ab40fc2a9eb41c4a9d9d`). There are now **29 migrations**.

Hosted catalog and HTTP checks confirm:

- The only anonymous function is fixed-metadata `public.preproduction_status`.
- API roles cannot select/update the private marker. Service role has **zero public/private table privileges**; its existing four link/submission RPCs remain the allowed interface.
- Existing grants, codes and QR links were classified as test-only; there were no non-test grants, codes or links after migration.
- The live unsigned phase preflight works without signing in. Production-state denial/demotion/race tests were run on disposable local PostgreSQL, not by promoting this hosted project.

All 61 project function bodies match a fresh local replay. One additional hosted-only `public.rls_auto_enable` event-trigger function is outside the project migration model: its inspected body enables RLS on new public tables, its search path is pinned, and none of anon/authenticated/service role can execute it. It was retained.

This does not provide a gateway, signed freshness or protection against a database owner. See [the controls and human cutover order](LIFECYCLE_CONTROLS.md).

## Browser and public submission evidence

A fresh labelled synthetic conference `a410008d-8d79-478c-9a08-341952f6af0a` contained one committee, five fictional delegates, a current session and an In Debate resolution. The **local production build of the exact app candidate** used the hosted database. This is real hosted RPC/Auth/Realtime behavior with independent Chrome contexts, not physical venue devices and not a signed-in browser run against the protected Vercel URL.

The public HTTP verifier passed resolution/amendment creation, concurrent exact retries, source/wording deduplication, changed-payload and scope refusals, legacy-title compatibility and Docs-only refusal. It created two Draft resolutions and one amendment. Separate live role checks showed that the owning Chair could read both Drafts; Approval and Logistics could read neither, held only their respective test-class role and could read their permitted snapshots.

The third complete offline browser run passed **39 assertions, zero hosted-only skips and zero failed scenarios (S0–S10)**. It covers durable offline actions and reload, automatic drain, lost-response retries with one effect, double-tap/idempotency, stale conflict retention and export-before-dismissal, work queued behind a conflict, recovery export, leaderboard accuracy, cross-device/server equality and zero uncaught page errors. An opening-read race probe sent without a nudge; the printed latency rounded to zero seconds. This single informational measurement is not a p95 or capacity result.

Two earlier runs remain recorded as failed:

1. The helper treated unrelated empty-queue copy as a completed Finish save and hard-navigated before the IndexedDB transaction committed. A controlled local reproduction failed on the original helper and passed after waiting for the actual Chair heading and the specific durable finished speech. No product behavior was changed for this harness fix.
2. The final leaderboard assertion captured an old checkpoint before navigation, then compared it with a newer refreshed screen. It now navigates first and requires exact live points within a bounded wait, followed by unchanged A/B/server equality checks.

The passing run used the corrected harness at `5c1b29b`; product code remained the exact `4db21e5` app candidate. Failed-run evidence was preserved separately. Thirty-three emitted public JS files were scanned: **zero occurrences of the validated server key**.

The supplied server-key value originally contained two concatenated secret-key strings. Read-only probes showed only one valid for this project. The validated single value was installed locally and in the intended Sensitive Vercel settings, including only the connected branch for Preview. No key was printed or committed. This remains a **preproduction key**, including the value currently saved for future Production builds: replace it with a fresh Production-only key and retire the test key at cutover. Immutable connected Previews and local credentials still require retirement.

After verification, this fixture's grants, codes and both QR links were revoked: **zero active fixture grants/codes/links**. No conference, user, document, receipt or history row was deleted. Auth sessions/API keys are separate retirement controls; the global token wait-out has not started. Other conferences remained at 176 receipts, three documents and ten delegates, matching the pre-test counts.

## Remaining release work

- Correct and review the load runner before 31 October: its old simulated client follows superseded sync behavior and is not suitable for current readiness claims. Reuse the actual client, require observed traffic and a drained outbox, and keep simulated notification fanout distinct from real Realtime testing. No hosted load has run.
- Run the approved Small-compute workload, real Realtime/voting checks and any approved rerun in the booked window. Confirm billing, backup/restore requirements and any separately approved recovery spending first.
- Manually verify a real Google Doc in the intended Chair/Approval accounts. Synthetic IDs prove registration, not existence or Anyone-with-link/edit access. Physical-device venue offline reopening remains separate.
- After the last synthetic test, the human operator performs reviewed cleanup, credential/session/key/connector and Preview retirement, the confirmed 3,600-second token wait (plus the recorded margin/older-token check), formal promotion, first production Executive bootstrap and exact-candidate deployment. Cloud-agent hosted access ends at promotion.

These results are preparation evidence, **not release approval or permission to cut over**. Sanitized machine-readable results are in [the evidence record](evidence/precutover-2026-10-26.json); the complete three browser reports and logs remain in the task's local output folder.
