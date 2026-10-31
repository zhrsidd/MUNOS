# Incident log - diagnostic attempt after NO-GO ramp
Times UTC, 31 Oct 2026. No secrets or personal data. No STOP was given by the owner.

| # | UTC | Stage | What was seen (source) | STOP row? | Action taken / by | Resolved | Owner told? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 12:45 | S0 | Report fine; first edge-log status query returned a blank status field (wrong attribute name), so an early "no 4xx/5xx" reading was unreliable; re-run with the correct field (169 requests all 200/204) | no | Operator corrected the query | 12:47 | yes |
| 2 | 12:53 | R1 | Runner exit 1: only "declared critical operations observed" failed (sendToApproval 0 of 2). Cause: GA1 and GA3 had no Draft left after S0 | no | R1 recorded NO-GO; owner accepted it as a ramp step with the recorded deviation | 13:01 | yes |
| 3 | 13:41 | R3 | Runner exit 1: write p95 2294 ms (limit 1500), read p95 4459 ms (limit 2500), sendToApproval 0. Slow-read tail up to ~6 s; 0 errors, 0 5xx | no (real NO-GO) | Ramp stopped; owner approved one rerun | 13:42 | yes |
| 4 | 13:38 | R3 prep | A malformed shell check by the operator was blocked by a built-in safety check; nothing was removed or changed | no | Re-ran a correct command | 13:38 | no |
| 5 | 13:50 | R3b | Runner exit 1: read p95 3442 ms (write p95 1086 ms passed), sendToApproval 0. Runner host ruled out (peak 13 % of one core) | no (real NO-GO) | Stopped; owner decided on H3 | 13:51 | yes |
| 6 | 14:28 | H3 | Runner exit 1: write p95 2726 ms, read p95 6215 ms, 181 pending and 4 conflicts at close after the 120 s drain; 4 HTTP 409 on apply_conference_mutation; no 5xx | no | Evidence written; nothing rerun | 14:29 | yes |
| 7 | 13:35 | container | Operator container had booted ~13:35 (uptime 9 min at 13:44), just before R3 at 13:36 | no | Recorded; R3b run after it had settled | 13:44 | yes |
| 8 | 14:11-14:13 | H3 | Watcher metrics (relayed by the owner): Postgres CPU 80 to 98 % across several minutes, 98.4 % at 14:11-14:13; meets STOP row 4 (> 90 % for 2 consecutive minutes) | **row 4** | Owner waived the STOP; the run continued and ended normally | 14:28 | yes (it was the owner's call) |
| 9 | 14:18, 14:24 | H3 | Watcher per-minute table: read p95 about 8 s in two minutes, never 3 consecutive minutes | row 3 not met | none | 14:28 | yes |
| 10 | 14:36-14:37 | cleanup | Fixtures A and B revoke-only cleanup applied by the operator with execute_sql under owner approval; counts verified | no | none needed | 14:37 | yes |
| 11 | 14:09-14:24 | H3 | Watcher final per-minute table: write p95 peak 2893 ms (14:09), read p95 peak 8350 ms (14:18) and 8116 ms (14:24), longest request 12.4 s (14:12); no 3 consecutive minutes over 8 s | row 3 not met | none | 14:28 | yes |
