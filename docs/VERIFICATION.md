# Baseline verification — 5 October 2026

## Confirmed

- Applied normalized foundation, access hardening, read-performance experiment and stable-policy restoration migrations to development project `opmydpozhdgkpcnjwpqb`.
- Remote schema: 24 public tables with RLS, 72 public foreign keys, zero anonymous table grants and zero direct authenticated write grants; two private tables.
- Development seed and generated remote TypeScript types saved in repository.
- Remote rollback-transaction tests: ungranted identity denied, committee isolation, direct writes denied, role escalation denied and participation retry exactly once.
- Real Data API workflow: attendance, Speech +2 / opportunity +1, duplicate retry, queue, submission, review, approval, printing, debate, mixed voting, configured outcome, audit and fresh repository persistence. See `remote-workflow-results.json`.
- Twelve local tests pass, including fresh PostgreSQL migration/RLS tests and durable IndexedDB restart, response-loss, duplicate retry, conflict retention and concurrent-tab tests.
- Typecheck, lint (zero warnings), all 12 tests and production build passed on the baseline code.
- Security advisor after hardening: zero findings. Performance advisor: informational unused indexes on the fresh database, no missing-FK-index warnings. Final post-optimization advisor refresh remains part of follow-up verification.
- Browser: development Supabase connection and Realtime confirmed; Chair renders remote data. Offline scoring, timer and queue actions persisted across offline navigation. Further recovery checks are ongoing at the requested early baseline push.

## Capacity evidence and limits

`load-test-before-optimization.json` records 150 concurrent operational clients, 1,500 measured requests, zero errors, 150 participation records despite duplicate retries, 150 attendance records, 150 printed resolutions, and 150 successful Realtime connections/reconnections. Burst-read p95 was 10,095 ms; this is too slow to call conference capacity comfortable. The optimized-policy rerun (`load-test-results.json`) produced pool/statement timeouts, 91 participation events and 84 completed print workflows. The speculative optimization was reverted in a recorded migration before the baseline push. A fresh sustained-load retest and resource investigation are required; capacity is not accepted.

This test reused one explicitly authorized identity. It does not verify 150 distinct anonymous enrollments or school NAT behavior. Fresh signup rate limits remain a production release gate. Database CPU was not available through the Data API.

## Remaining acceptance checks after the requested early push

- Finish browser offline restore/exact-once verification, close/reopen, two independent Chair browsers, mobile and all role screens on the final build.
- Review final optimized load report and address remaining tail latency before conference readiness.
- Test distinct-user enrollment and refresh behavior on the school network with configured limits.
- Real PDF upload failure and Drive failure tests are deferred with those integrations.
- Staging/production setup, deployment, monitoring and rollback rehearsal are not part of this baseline.

No production project was created or modified. No secrets/service keys are present in client code. This is a tested development baseline with explicit remaining release gates, not a production-readiness claim.
