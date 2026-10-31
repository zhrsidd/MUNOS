# S0: 10 staff, 5 min, fixture A 573cfbeb-d3ed-4cf5-b418-7d36326f69c8
Commit 288c723 / deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR. Operator: Claude. Decider: Zuhayr Siddique.
Pool refresh (PF23) 12:40:27 UTC. Command entered 12:40:42 UTC. Report written 12:45:43 UTC, exit 0, drainSeconds 0.

| # | Checkpoint | Value read | P/F |
| --- | --- | --- | --- |
| G | diagnosticVerdict.pass / readinessLabel | true / RAMP / DIAGNOSTIC ONLY (verdict.pass false = NOT A READINESS RUN, expected; 6 of 19 Chair committees) | P |
| C1 | duplicates / lost | 0 / 0 (8 acknowledged scoring) | P |
| C2 | error rate | 0 % (0 errors of 163 requests, 0 conflicts) | P |
| C3 | rate-limited (429) | 0 | P |
| C4 | worst write p95 | 856 ms (limit 1500) | P |
| C5 | worst read p95 | 1166 ms (limit 2500) | P |
| C6 | pending / conflicts / unconfirmed at close; closeTimedOut | 0 / 0 / 0; false | P |
| C6a | observed vs configured | 10 devices opened; reads chair 67, admins 8, executive 27, approval 13; writes chair 42, admins 1, approval 1; 12 action kinds; all work checks pass | P |
| C7 | 5xx, PGRST003, 40001, 57014 (operator, logs) | Supabase edge logs 12:40:30-12:47: 169 requests, 125 x 200 and 44 x 204, no 4xx/5xx; Postgres ERROR/FATAL entries: 0 | P (operator read) |
| C8 | Postgres CPU | not read | - |
| C9 | DB connections | not read (no pg_stat_activity sample was taken during S0) | - |
| C10 | memory / disk IO | not read | - |
| C11 | original-conference fingerprint | identical to fingerprint-before.txt | P |
| C12 | Vercel 5xx / timeouts | get_runtime_errors since 12:40 UTC: none; no runtime log entries | P |
| C13 | settle 2 min | not timed (decider did not time a settle; R1 started after the pool refresh) | - |

STOP condition seen: none reported in this chat. **S0: GO** - decided by Claude on owner instruction, 12:48 UTC. (Recorded after the 12:45:43 report; the owner's instruction was received in this chat and applied after C8-C10 and C13 were left unread/untimed.)
