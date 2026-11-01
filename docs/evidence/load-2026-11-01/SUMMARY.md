# Load evidence summary: R3 and H3, 31 October to 1 November 2026

Secret-free summary of the watched test run on DCMUN Staging. The raw evidence (runner reports with samples, session files, dashboard images) stays on the operator's machine under `evidence/load-2026-11-01/` and is not in git. Times are UTC; Qatar is UTC+3.

**Result.** The runner's final verdict for H3 is **READINESS RUN, pass** (110 staff, 30 minutes, 19 committees). Server logs, the owner's dashboard readings and the database fingerprints agree with it. This summary records evidence. The capacity-gate decision and the release approval remain with the owner, the independent reviewer and the release approver.

## What was run

| | |
| --- | --- |
| Candidate | `main` at `032daa5` (includes #93 snapshot pre-filter, #94 own-echo suppression and 15 s support refresh, #96 rehearsal fixes) |
| Target | DCMUN Staging, ref `kllhswucdhqqywnzxado`: Pro, Small compute, 90 connections, 37 migrations through `20261101090000_snapshot_committee_prefilter`, PITR off |
| App | Connected protected Preview `dpl_AgKbB2jJNzS3hpnMhvPCS63JNmwg` (branch `codex/preproduction-connected`) |
| Schedule | The owner moved the start from the planned 16:00 Qatar window to the night of 31 October. S0, R1 and R2 were skipped by the owner, and R3 was the only ramp stage |
| R3 | Fixture A `bd211427-4dda-40b0-953e-651dfe5a2a57`, 80 staff, 5 minutes, runner 22:37:23 to 22:42:29 |
| H3 | Fixture B `ee243abf-e315-4c9c-a83f-a523b89bb42a`, 110 staff (75 Chair, 20 Approval, 10 Admin, 5 Executive), 150 public page loads, 16 submissions, runner 23:05:45 to 23:35:50 |

## Results

| | R3 | H3 |
| --- | --- | --- |
| Runner verdict | diagnostic pass, exit 0 | `verdict.pass: true`, label READINESS RUN, `conferenceGate.pass: true` |
| Errors / 429 / conflicts | 0 / 0 / 0 (0 of 1,129) | 0 / 0 / 0 (0 of 13,080) |
| Write p95 (runner) | worst action 723 ms (`poiScore`) | 191 ms aggregate; runner check "worst per-action" 688 ms (public submit); worst staff action 393 ms (`poiAdd`) |
| Read p95 (runner) | 1,572 ms | 2,371 ms (limit 2,500) |
| Longest request | 2,716.7 ms | 6,327 ms (Executive refresh) |
| Pending / conflicts / unconfirmed at close | 0 / 0 / 0, drain 1 s | 0 / 0 / 0, drain 3 s, unresolved work 0 |
| Public form | not exercised | 150 of 150 pages (p95 479 ms), 16 of 16 submissions |

H3 reads by role (p95): Chair 1,449 ms, Approval 2,682 ms, Executive 3,080 ms, Admin 3,425 ms. The runner's read check is per action (the refresh, 2,371 ms), so the support roles are recorded as an observation, not a failure. One resend row, `poiAdd (resend)`, has p95 1,773 ms on 8 requests; the runner's worst-action check does not count resend rows, and every other action is under 400 ms. 195 resends, all successful, account for the difference between the 1,877 accepted writes and about 2,027 server write requests.

H3 activity: 10,788 snapshots (Chair 7,561; Approval 1,813; Admin 884; Executive 530) and 1,877 writes (Chair 1,788; Admin 46; Approval 43). Main actions: 580 queueAdd, 223 speechStart, 214 speechScore, 214 speechFinish, 121 rollCall, 87 each of four point actions, 59 queueOrder, 46 print, 43 approve, 29 sendToApproval.

## Server-side logs (independent of the runner)

Edge and Postgres logs, H3 window 23:05 to 23:37:

| | Requests | p50 | p95 | p99 | Longest |
| --- | --- | --- | --- | --- | --- |
| Reads | 10,571 | 307 ms | 2,298 ms | 3,328 ms | 6.3 s |
| Writes | 2,027 | 58 ms | 138 ms | 576 ms | 2.7 s |

All 15,525 API requests returned 200 or 204. There were no 5xx, 429 or 4xx responses and no Postgres errors or warnings (no 40001, 57014 or PGRST003). The slowest minute was 23:31 (read p95 4.1 s, write p95 1.6 s), and the next minute was normal. R3 server-side: reads p95 1,570 ms, writes p95 114 ms, no errors.

Data checks: no duplicated mutation IDs on fixture B; participation events 301, equal to 214 speech scores plus 87 point scores; the 16 new documents match the 16 public submissions.

## Dashboard readings (owner, Supabase Observability)

Memory is "Used", not including cache. Times are approximate (read from the chart).

| UTC | CPU | Memory (Used) | Connections |
| --- | --- | --- | --- |
| Idle before H3 (22:49 to 23:00) | 0.5 to 0.7% | 52 to 58.5% | 33 to 34 of 90 |
| 23:10 | 52.4% | 58.55% | 33 |
| 23:15 | peak 62.9%, then 53.1% | 57% | 36 |
| 23:20 | 51.8% | 58.37% | 35 |
| 23:25 | 53.5% | 58.05% | 35 |
| 23:32 | 55.9% | 58.7% | 35 |
| 23:38 (after the run) | 4.8% | 45.5% | 28 |
| 23:44 | 0.55% | 40.4% | 25 |

R3: peak sampled CPU 34.3%, peak connections 35 of 90. H3 CPU stayed between about 48% and 63%. No STOP threshold was reached.

## Comparison with the 31 October attempt (same plan, before #93 and #94)

| | 31 Oct H3 | 1 Nov H3 |
| --- | --- | --- |
| Read p95 | up to 8,350 ms per minute, 6,215 ms overall | 2,371 ms overall, worst minute 4.1 s |
| Peak CPU | 98.4% | 62.9% |
| Writes pending after drain | 181 | 0 |

The 31 Oct figures are from the run sheet and the operator's report of that run. Snapshot read counts for 31 October are not compared here because they are not recorded in a form that can be re-checked.

## Isolation and cleanup

- The original conference fingerprint was identical before, after every stage and after settle: 24 operational changes, last change 2026-10-25 23:43:50.904606, 11 active grants, 1 document, 2 attendance rows, 30 audit rows. No change appeared in any conference outside fixtures A and B.
- Fixture A was revoked before H3 and fixture B at 23:56:32. At 23:59 there were 0 live grants on every conference and 0 open fixture links.
- Staging holds nine synthetic conferences, all labelled test data or load tests, with 0 non-test grants.

## Deviations and incidents

1. The owner moved the start from 16:00 Qatar and skipped S0, R1 and R2.
2. A separate watcher session took the R3 baselines, but its R3 T-1 baseline was missed and its Realtime and production-surface coverage was unavailable. The owner read CPU, memory and connections from the dashboard about every five minutes through H3, and server logs were read by Claude.
3. The Preview's Executive screen is bound to the original conference, so fixture B's GA1 submission link was created through the existing outbox path (`apply_operations_mutation`, command `submissionLink`) as B's own Executive identity at 23:04:12, owner-authorised, one change.
4. The local PostgreSQL 17 tests were skipped on the operator's machine (862 passed, 58 skipped). The owner accepted CI run 41243190323 on the same code (993 passed, 0 skipped) in their place.
5. The 31 October session files were deleted, so 22 new anonymous identities and one preparation session were created once, with no rate limit.
6. After the runner exited, the operator's status still said "running" for about 12 minutes (a stale PID check). The server showed no traffic after 23:35:45.
7. One early memory reading (92.6%) included cache; Used was 52.19%.

## Not covered by this evidence

Disk IO and swap readings were not recorded. Realtime delivery is simulated by the runner. The real-browser functional checks (reconnect, roll-call correction, public amendment access, revocation) were not part of this run. A watcher metrics feed did not run during H3. The independent reviewer's and release approver's sign-offs are still to be recorded.
