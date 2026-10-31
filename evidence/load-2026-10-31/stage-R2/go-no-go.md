# R2: 50 staff, 5 min, fixture A 573cfbeb-d3ed-4cf5-b418-7d36326f69c8
Commit 288c723 / deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR. Operator and decider: Claude (on owner instruction). STOP authority: Zuhayr Siddique.
Pool refresh (PF23) 13:01:37 UTC. Command entered 13:01:37 UTC. Report written 13:06:42 UTC, exit 0, drainSeconds 1.

| # | Checkpoint | Value read | P/F |
| --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` true; `readinessLabel` RAMP / DIAGNOSTIC ONLY; `readiness.label` READINESS RUN (all 19 committees configured); `capacityGate` "BELOW the current 110-device gate (historical 50-staff C2 comparison / ramp step)"; exit 0 | P |
| C1 | duplicates / lost | 0 / 0 (24 acknowledged scoring) | P |
| C2 | error rate | 0 % (0 errors of 823 requests, 0 conflicts) | P |
| C3 | rate-limited (429) | 0 | P |
| C4 | worst write p95 | 834 ms (limit 1500) | P |
| C5 | worst read p95 | 2057 ms (limit 2500) - closer to the limit than S0 (1166) and R1 (1197) | P |
| C6 | pending / conflicts / unconfirmed; closeTimedOut | 0 / 0 / 0; false | P |
| C6a | observed vs configured | 50 devices opened; reads approval 128, admins 54, chair 372, executive 98; writes approval 5, chair 158, admins 2; actions approve 5, rollCall 33, queueAdd 39, speechStart 19, poiAllowance 8, poiAdd 8, poiRecognize 7, poiScore 7, speechScore 17, print 2, speechFinish 17, **sendToApproval 1** (observed, so the R1 deviation did not recur), queueOrder 2 | P |
| C7 | 5xx, PGRST003, 40001, 57014 | Supabase edge logs 13:01:30-13:07:30: 826 requests (663 x 200, 163 x 204), no 4xx/5xx; Postgres ERROR/FATAL: 0 | P (operator read) |
| C8 | Postgres CPU | not read | - |
| C9 | DB connections (limit 90) | not read from the dashboard. Operator pg_stat_activity samples (total / client backends): 25/17 (13:01:43); 34/26 (13:02:47); 34/26 (13:03:55); 34/26 (13:05:07). Peak sampled 34 of 90 = 37.8 %; no idle-in-transaction. Spot reads, not a continuous peak | not read (sampled only) |
| C10 | memory / disk IO | not read | - |
| C11 | original-conference fingerprint | identical to fingerprint-before.txt | P |
| C12 | Vercel 5xx / timeouts | get_runtime_errors since 13:01 UTC: none | P |
| C13 | settle 2 min | not timed | - |

STOP condition seen: none.

**R2: GO** - decided by Claude on owner instruction, 13:07 UTC, on the measured checks only. C8-C10 and C13 are not read/timed; the owner requires a person to read C8-C10 from the dashboards before R3 and H3.
