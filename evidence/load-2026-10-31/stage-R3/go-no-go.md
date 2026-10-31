# R3: 80 staff, 5 min, fixture A 573cfbeb-d3ed-4cf5-b418-7d36326f69c8
Commit 288c723 / deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR. Operator and decider: Claude (on owner instruction). STOP authority: the owner.
Pool refresh (PF23) 13:36:09 UTC. Command entered 13:36:09 UTC. Report written 13:41:17 UTC. **Runner exit code 1**, drainSeconds 2.

| # | Checkpoint | Value read | P/F |
| --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` **false**; exit 1. Failing checks: write p95, read p95, declared critical operations. `readiness.label` READINESS RUN (19 committees) | **F** |
| C1 | duplicates / lost | 0 / 0 (24 acknowledged scoring) | P |
| C2 | error rate | 0 % (0 errors of 1146 requests, 0 conflicts) | P |
| C3 | rate-limited (429) | 0 | P |
| C4 | worst write p95 | **2294 ms (limit 1500)** | **F** |
| C5 | worst read p95 | **4459 ms (limit 2500)** | **F** |
| C6 | pending / conflicts / unconfirmed; closeTimedOut | 0 / 0 / 0; false | P |
| C6a | observed vs configured | 80 devices opened; reads approval 161, chair 562, executive 121, admins 82; writes chair 203, approval 5, admins 3; actions rollCall 54, queueAdd 66, speechStart 17, poiAllowance 8, poiAdd 8, poiRecognize 7, poiScore 7, speechScore 17, speechFinish 17, approve 5, queueOrder 2, print 3; **sendToApproval 0** | **F** (sendToApproval) |
| C7 | 5xx, PGRST003, 40001, 57014 | Supabase edge logs 13:36-13:42:30: 1179 requests (965 x 200, 214 x 204), no 4xx/5xx; Postgres ERROR/FATAL: 0 | P (operator read) |
| C8 | Postgres CPU | **not measured**: the watcher's monitor started at 13:41 UTC, after R3's run window (13:36-13:41) | - |
| C9 | DB connections (limit 90) | not read from the dashboard. Operator pg_stat_activity samples (total / client backends): 15/7 (13:36:17); 15/7 (13:36:46); 20/12 (13:38:07); 43/35 (13:39:27); 43/35 with 19 active (13:40:47); 43 (13:41:47). Peak sampled 43 of 90 = 47.8 %; no idle-in-transaction. Spot reads, not a continuous peak | not read (sampled only) |
| C10 | memory / disk IO | not read | - |
| C11 | original-conference fingerprint | identical to fingerprint-before.txt | P |
| C12 | Vercel 5xx / timeouts | get_runtime_errors since 13:36 UTC: none | P |
| C13 | settle 2 min | not timed | - |

STOP condition seen: none reported.

**Latency detail (from the private samples, not in the evidence folder):** medians are normal (chair refresh p50 403 ms, executive 1072 ms, admins 701 ms, approval 437 ms), but the slowest individual reads reached 4.9 s (chair), 5.5 s (approval), 5.9 s (admins) and 6.1 s (executive). That is a tail of slow reads (a short stall or burst), not uniform slowness. Cause not identified. Read p95 across stages: S0 1166, R1 1197, R2 2057, R3 4459 ms; write p95: 856, 876, 834, 2294 ms.

**sendToApproval:** not observed, same cause as R1 (the Draft in the targeted committees GA1, GA3, C17 was already consumed: GA1/GA3 by S0, C17 by R2 which observed 1). Covered by the owner's recorded deviation.

**R3: NO-GO** - decided by Claude on the owner's rule, 13:42 UTC. It fails on the latency thresholds C4 and C5, which are not covered by the sendToApproval deviation. Per the owner's instruction any other failure is a real NO-GO: the ramp stops here. H3 is NOT started and needs the owner's decision.
