# R3b: 80 staff, 5 min, fixture A 573cfbeb-d3ed-4cf5-b418-7d36326f69c8 (new attempt, owner approval ~13:50 UTC; R3 evidence unchanged)
Commit 288c723 / deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR. Operator and decider: Claude. STOP authority: the owner.
Same command as R3. Pool refresh (PF23) 13:45:11 UTC; command entered 13:45:11 UTC; report written 13:50:18 UTC; **runner exit code 1**; drainSeconds 2.

## Container before the run (13:44:28 UTC)
nproc 4; free -m: 16091 MB total, 498 used, 15525 free, 0 swap; /proc/loadavg 0.02 0.03 0.00; uptime 13:44:57 "up 9 min, load average 0.01, 0.03, 0.00". No node, tsx, postgres, npm or test processes running. Note: the container had only been up ~9 minutes (booted ~13:35), i.e. R3 (13:36) ran right after it started; R3b did not.

## Runner sampler (local only, every 10 s; file `runner-sampler.log`)
Runner = node process PID 906 (child of tsx). 30 samples. Instantaneous CPU (from /proc/stat deltas; ps %cpu is a lifetime average): **peak 13.0 % of one core (13:50:03), mean 5.5 %; 0 samples at or above 95 %**. Load average peak 0.41 (1-minute, 4 cores). Peak established TCP connections 45. Peak RSS 260 MB. **The runner/generator was not pegged and the machine was nearly idle, so the generator is not the bottleneck.**

| # | Checkpoint | Value read | P/F |
| --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` **false**; exit 1. Failing: read p95, declared critical operations | **F** |
| C1 | duplicates / lost | 0 / 0 (24 acknowledged scoring) | P |
| C2 | error rate | 0 % (0 errors of 1017 requests, 0 conflicts) | P |
| C3 | rate-limited (429) | 0 | P |
| C4 | worst write p95 | 1086 ms (limit 1500) | P |
| C5 | worst read p95 | **3442 ms (limit 2500)** | **F** |
| C6 | pending / conflicts / unconfirmed; closeTimedOut | 0 / 0 / 0; false | P |
| C6a | observed vs configured | 80 devices opened; reads approval 102, chair 526, executive 128, admins 51; writes chair 198, admins 2, approval 2; actions rollCall 54, queueAdd 60, queueOrder 3, speechStart 17, poiAllowance 8, poiAdd 8, poiRecognize 7, poiScore 7, speechScore 17, speechFinish 17, print 2, approve 2; **sendToApproval 0** | **F** (sendToApproval only; waived by the recorded deviation) |
| C7 | 5xx, PGRST003, 40001, 57014 | Supabase edge logs 13:45-13:51:30: 1051 requests (848 x 200, 203 x 204), no 4xx/5xx; Postgres ERROR/FATAL: 0 | P (operator read) |
| C8 | Postgres CPU | peak 51 % (average limit 70 %; no 5-minute window above 85 %). source: watcher metrics feed (node-wide CPU, ~2-minute averages) and edge logs, relayed by the owner; NOT read by the operator | P |
| C9 | DB connections (limit 90) | not read from the dashboard. pg_stat_activity samples (total / client backends): 43/35 (13:47:03); 43/35 (13:48:17); 42/34 (13:49:28). Peak sampled 43 of 90 = 47.8 %; none idle in transaction. Spot reads only | not read (sampled only) |
| C10 | memory / disk IO | not read | - |
| C11 | original-conference fingerprint | identical to fingerprint-before.txt | P |
| C12 | Vercel 5xx / timeouts | get_runtime_errors since 13:45 UTC: none | P |
| C13 | settle 2 min | not timed | - |

**Latency detail (private samples):** medians are as before (chair refresh p50 440 ms, executive 1060 ms, admins 729 ms, approval 448 ms) but the slowest single reads again reached 4.2 s (chair), 4.2 s (approval), 4.8 s (admins) and 6.1 s (executive), matching R3 (4.9 / 5.5 / 5.9 / 6.1 s). So the slow-read tail repeats at 80 staff with the same shape; writes were fine this time (1086 ms vs 2294 ms in R3). Across attempts at 80 staff: read p95 4459 (R3) and 3442 (R3b) ms; at 50 staff 2057 ms; at 25 staff 1197 ms. Cause not identified; the generator host is ruled out by the sampler.

**sendToApproval:** 0 observed, same cause as R1/R3 (Drafts in the targeted committees already consumed). Covered by the recorded deviation.

**R3b: NO-GO** - decided by Claude on the owner's rule, 13:51 UTC. Read p95 fails the threshold (C5), which the deviation does not cover. H3 is not started.
