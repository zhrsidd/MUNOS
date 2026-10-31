# R1: 25 staff, 5 min, fixture A 573cfbeb-d3ed-4cf5-b418-7d36326f69c8
Commit 288c723 / deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR. Operator and decider: Claude (on owner instruction). STOP authority: Zuhayr Siddique.
Pool refresh (PF23) 12:48:42 UTC. Command entered 12:48:42 UTC. Report written 12:53:46 UTC. **Runner exit code 1**, drainSeconds 0.

| # | Checkpoint | Value read | P/F |
| --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` **false** (label RAMP / DIAGNOSTIC ONLY); exit code 1. Failing check: "stage 1: declared critical operations were observed" (sendToApproval scheduled 2, observed 0). verdict also fails the expected "NOT A READINESS RUN: 16 distinct Chair identities for 19 committees" | **F** |
| C1 | duplicates / lost | 0 / 0 (22 acknowledged scoring) | P |
| C2 | error rate | 0 % (0 errors of 455 requests, 0 conflicts) | P |
| C3 | rate-limited (429) | 0 | P |
| C4 | worst write p95 | 876 ms (limit 1500) | P |
| C5 | worst read p95 | 1197 ms (limit 2500) | P |
| C6 | pending / conflicts / unconfirmed; closeTimedOut | 0 / 0 / 0; false | P |
| C6a | observed vs configured | 25 devices opened; reads chair 201, approval 62, admins 39, executive 33; writes chair 109, approval 7, admins 1; actions rollCall 16, approve 7, queueAdd 15, speechStart 21, poiAllowance 7, poiAdd 7, poiRecognize 6, poiScore 6, speechScore 16, speechFinish 15, print 1; **sendToApproval 0** (declared operation not observed) | **F** |
| C7 | 5xx, PGRST003, 40001, 57014 | Supabase edge logs 12:48:30-12:54:30: 502 requests (383 x 200, 119 x 204), no 4xx/5xx; Postgres ERROR/FATAL: 0 | P (operator read) |
| C8 | Postgres CPU | not read | - |
| C9 | DB connections (limit 90) | not read from the dashboard. Operator pg_stat_activity samples (total / client backends): baseline 17/9 (12:48:13); 18/10 (12:48:49); 18/10 (12:48:54); 17/9 (12:49:52); 24/16 (12:51:07); 24/16 (12:52:22); 24/16 (12:53:49). Peak sampled 24 of 90 = 26.7 %; no idle-in-transaction. Samples are a few spot reads, not a continuous peak | not read (sampled only) |
| C10 | memory / disk IO | not read | - |
| C11 | original-conference fingerprint | identical to fingerprint-before.txt | P |
| C12 | Vercel 5xx / timeouts | get_runtime_errors since 12:48 UTC: none | P |
| C13 | settle 2 min | not timed | - |

STOP condition seen: none.

**Likely cause (not proven for the exact committees):** the harness runs `sendToApproval` only when the committee still has a `Draft` document (scripts/rehearsal-run.mts:304) and otherwise skips silently without a local refusal. After S0 (which sent 2 and approved/printed others on fixture A), GA1 and GA3 have no Draft document left (DB read ~12:54 UTC: GA1 draft 0/submitted 1/approved 1/printed 1; GA3 draft 0/approved 3; the other 17 committees still have 1 Draft). This points to fixture A state consumed by S0, not an application fault. Safety numbers (C1-C7, C11, C12) are all clean.

**R1: NO-GO** - decided by Claude on owner instruction, 12:55 UTC, because G fails (rule: `diagnosticVerdict.pass` must be true) and the sheet says a NO-GO ends the ramp. R2 is not started. Re-running or changing fixture A needs the owner's decision.

## Owner decision and recorded deviation (applied after the read-only confirmation)
Read-only confirmation (scenario rebuilt with the run's parameters; DB read): R1's two scheduled `sendToApproval` steps targeted **GA1** and **GA3**, the same committees as S0's two. After S0, GA1 has 0 Draft documents (1 submitted, 1 approved, 1 printed) and GA3 has 0 (3 approved), so the harness skipped both (it acts only on a Draft). The other 17 committees still had 1 Draft each. R2, R3 and H3 target GA1, GA3 and C17 (C17 still has a Draft).

**Deviation (owner decision):** "NO-GO under C-rule solely on sendToApproval not observed; all safety checks passed; likely cause: GA1/GA3 had no Draft left after S0." R1 is accepted as a ramp step with this deviation. Fixture data was not edited. If R2 or R3 fail only on this same check, the same deviation applies; any other failure is a real NO-GO and stops the ramp.

**Recorded deviation, owner's wording (31 Oct):** "NO-GO under C-rule solely on sendToApproval not observed; all safety checks passed; likely cause: GA1/GA3 had no Draft left after S0." The owner accepted R1 as a ramp step with this deviation.
