# Independent capacity evidence review · 1 November 2026

**Verdict: the H3 runner PASS has been independently recomputed from its raw samples. Complete operator capacity acceptance and production release sign-off remain open.** This review does not approve promotion, cleanup, a release or real-data entry. The [cutover preparation checklist](../../CUTOVER_PREP_2026-11-01.md) retains those gates.

## Source and scope

The reviewed application candidate is `032daa5864a38b377b0df96f20939512b554fcd7`, Preview deployment `dpl_AgKbB2jJNzS3hpnMhvPCS63JNmwg`, against synthetic preproduction project `kllhswucdhqqywnzxado`. The recorded H3 stage ran from 2026-10-31 23:05:45.700 to 23:35:50.938 UTC. See the [operator's summary](../load-2026-11-01/SUMMARY.md).

The independent reviewer read the operator-local raw report `.test-sessions/rehearsal-2026-10-31T23-35-50-938Z.json`, the sample-free `evidence/load-2026-11-01/stage-H3/report.json`, its supporting evidence files and the committed evaluator. No hosted query, write or test was performed by this review; the operator checkout was not changed. Neither raw samples nor credentials are copied here.

| Source | SHA-256 |
| --- | --- |
| Raw report | `1d7bcadc3e9f501e9b2dd0932635a951fd675f94ab88e9b98ceb8fc07660f9f1` |
| Sample-free report | `a82bd802a82e02869da764e2e1c2c3a008fa6bf4902855d4ef5def3ef78fed43` |

All fields other than the removed `samples` array match between the two reports. Re-running `report(samples)` reproduces every saved stage metric, action aggregate and summary exactly. Re-running `evaluate` passes every automated check. This independently validates the sample-derived metrics; saved population, observed-work and database-effect counters are not independently reconstructed from per-device network traces.

## Recomputed and cross-checked results

| Item | Result |
| --- | --- |
| Profile and coverage recorded by the runner | 110 staff: 75 Chair / 20 Approval / 10 Printing / 5 Executive; 19 committees with observed Chair traffic; 110 opened devices |
| Samples | 13,080; all outcomes `ok`; zero errors, conflicts or rate limits |
| Accepted first staff sends | 1,877, equal to the first-send sample count: Chair 1,788 / Approval 43 / Printing 46 |
| Explicit/automatic resend samples | 195, all successful |
| Staff send calls, including resends | 2,072 |
| Full snapshot reads | 10,788: 10,258 `conference_state_snapshot` + 530 `executive_state_snapshot`; one snapshot RPC per refresh |
| Read p95 / p99 | 2,371 / 3,469 ms |
| First staff write aggregate p95 / p99 | 191 / 725 ms |
| Worst checked first-action write p95 | 688 ms, public `submit`; worst staff action 393 ms, `poiAdd` |
| Public workload | 150 successful page loads, p95 479 ms; 16 successful submissions, p95 688 ms |
| Longest request | 6,327.187 ms, Executive refresh |
| Settled close recorded by the runner | Three-second drain; zero pending, conflicts, unconfirmed or unresolved work; no close timeout |
| Exactly-once effect check recorded by the runner | 301 acknowledged scoring mutations; zero duplicate or missing scoring effects |
| Workflow admission | Passed; all recorded critical-operation and observed-work checks passed |

Role-specific read p95 values are Chair 1,449 ms, Approval 2,682 ms, Printing 3,425 ms and Executive 3,080 ms. The [existing gate](../../LOAD_TEST_EXECUTION_PACKET.md) checks per action, not per role; these role figures are tail-latency observations, not a newly introduced failure criterion. Likewise, the eight-request `poiAdd (resend)` row has p95 1,773 ms, while the existing first-action evaluator excludes resend rows. Its exclusion was not introduced by this review.

### Roll-call metric correction

The evaluator checked the legacy action name `rollCall`, while current samples use `rollCallCommit`. This preparation change adds the current name and preserves the legacy one. A regression with a 10,000 ms current roll-call commit failed against the previous evaluator and passes with the correction; healthy current and legacy samples still pass. The observed H3 has 121 first `rollCallCommit` samples with p95 **166 ms**, so including that row leaves its recomputed verdict **PASS**, with the same 688 ms maximum. This is a harness correction; it does not change the application or retroactively relax a threshold.

## Request-count follow-up · 1 November, after browser verification

A read-only hosted log re-query using the exact H3 UTC interval **23:05:45.700–23:35:50.938 on 31 October** returns **2,072 `apply_conference_mutation` edge-log rows, all HTTP 204**, matching the runner's 1,877 first sends plus 195 resends. It also returns 16 `submit_resolution` rows, all HTTP 200, matching the public submissions. The earlier 2,027 figure is superseded for aggregate comparison; the old query/filter was not recovered, so its specific cause is not established. See [h3-log-requery.json](h3-log-requery.json) for the reproducible query and bounded results.

This closes the **aggregate 45-row count difference**, not request-by-request attribution. The 2,072 staff log rows contain 2,071 distinct, nonempty request IDs: one ID appears twice. No request IDs or credentials are included in this packet. The runner samples contain no timestamps, mutation UUIDs or request IDs, so individual correspondence and the repeated-ID cause remain unproven. Do not infer 2,072 unique server requests or use the count alone as proof of exactly-once effects. The receipt/effect checks remain separate evidence; this observability limitation must remain visible to the independent reviewer and release approver.

## Operator evidence still needed before cutover

- The evidence folder's `dashboard/metrics-log.csv` contains **two R3 rows and no H3 rows**. Its image files are preparation-time compute, PITR and backup screenshots; they do not supply H3 disk IO or swap readings.
- The summary records roughly five-minute owner CPU/memory/connection observations. Without suitable retained history, that cadence does not independently establish the required consecutive-minute STOP checks, rolling CPU windows, IO budget or swap behaviour. Recover suitable historical evidence, or explicitly record the owner/independent-reviewer decision on the evidence gap and have the release approver consider it. First-live monitoring supplements this evidence; it does not silently complete a pre-cutover check.
- The owner-authorised skipped S0/R1/R2 stages and moved window remain recorded deviations. The raw H3 report passes its full-profile checks, but that does not erase deviations from the watched procedure.
- Genuine Realtime delivery, connected-browser offline/reconnect and role workflows remain separate from this capacity runner's explicitly simulated notification delivery. Record their own candidate, fixture, results and retirement evidence before claiming those gates complete.
- The backup/PITR decision, compatible credential-rotated rollback deployment, final production source revision, John Paul Ribeiru's exact-SHA release approval and the owner's infrastructure approval remain separate. No such sign-off is supplied here.

**Independent review scope:** sample-derived runner metrics and evaluator outcome verified; complete operational capacity acceptance and production release approval not granted by this document.
