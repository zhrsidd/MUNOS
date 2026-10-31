# H3: 110 staff + public burst, 30 min, fixture B 1e6bb11f-95c2-4acc-9849-2047818cbdd4 - **diagnostic attempt after NO-GO ramp**
Departure from the run sheet: run on the owner's explicit GO (~13:50 UTC) after NO-GO ramp stages R3 and R3b. It was recorded as a diagnostic attempt; it is not a clean gate run.
Commit 288c723 / deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR. Operator and decider: Claude. STOP authority: the owner (no STOP was given).
Pre-start checks (13:55 UTC, read-only): SUBMIT_TOKEN set (value never printed); fixture B unchanged from its baseline (1 change, 1 audit row, 19 roll calls, 76 documents/resolution links, 22 grants valid to 16:17 UTC, 1 active link, 19 committees each with Draft/Review/Approved); original-conference fingerprint identical. PF23 pool refresh 13:55:55 UTC (0 created, 22 refreshed), command entered 13:55:55 UTC, i.e. within 5 minutes. Runner printed roles 75/20/10/5 and "150 public page loads, 16 resolution submissions planned" (exactly 16, as required). Report written 14:28:04 UTC, **runner exit code 1**, drainSeconds 120.

| # | Checkpoint | Value read | P/F |
| --- | --- | --- | --- |
| G | Gate verdict | `conferenceGate` eligible true, **pass false**; readinessLabel READINESS RUN; capacityGate "CURRENT capacity gate size (110 devices ...)"; exit 1 | **F** |
| C1 | duplicates / lost | 0 / 0 (255 acknowledged scoring) | P |
| C2 | error rate | 0 % (0 errors of 12505 requests; 4 conflicts = 0.24 per 100 writes) | P |
| C3 | rate-limited (429) | 0 | P |
| C4 | worst write p95 | **2726 ms (print)**; aggregate write p95 1834, p99 3187 (limit 1500) | **F** |
| C5 | worst read p95 | **6215 ms**; read p50 2197, p99 8387 (limit 2500) | **F** |
| C6 | pending / conflicts / unconfirmed; closeTimedOut | **181 pending**, **4 conflicts**, 0 unconfirmed at close after the 120 s drain; closeTimedOut false | **F** |
| C6a | observed vs configured | 110 devices opened; all 19 committees; 150 pages and 16 creates completed; all declared operations observed (sendToApproval 16, approve 34, print 38). See "work done vs plan" below | P/F (see note) |
| C7 | 5xx, PGRST003, 40001, 57014 | Supabase edge logs 13:55:50-14:30:30: 12446 requests (10735 x 200, 1707 x 204, 4 x 409 on apply_conference_mutation); no 5xx; Postgres ERROR/FATAL: 0 | P (operator read) |
| C8 | Postgres CPU | **fail**: readings of 80 to 98 % across several minutes, 98.4 % at 14:11-14:13 (limit: average < 70 %, STOP row 4 is > 90 % for 2 consecutive minutes). **STOP 4 condition met; the owner waived it** (no STOP was given). source: watcher metrics feed (node-wide CPU, ~2-minute averages) and edge logs, relayed by the owner; NOT read by the operator | **F** |
| C9 | DB connections (limit 90) | direct connections 36 to 38; spot peak 44 of 90 = 48.9 % (below 67). source: watcher metrics feed (node-wide CPU, ~2-minute averages) and edge logs, relayed by the owner; NOT read by the operator; the 44 is the operator's own pg_stat_activity spot read | P |
| C10 | memory / disk IO | memory peak 64.7 % in the first relay (65.0 % in the watcher's final summary, 14:24:52 reading), swap 0, Disk IO balance 99 %. source: watcher metrics feed (node-wide CPU, ~2-minute averages) and edge logs, relayed by the owner; NOT read by the operator | P |
| C11 | original-conference fingerprint | identical to fingerprint-before.txt | P |
| C12 | Vercel 5xx / timeouts (/api/*, /submit/*) | get_runtime_errors since 13:55 UTC: none | P |
| C13 | settle 2 min | at 14:29:52 UTC (about 2 minutes after H3's end): CPU 3.7 %, memory 26 %, 9 connections, 0 lock waits. source: watcher metrics feed (node-wide CPU, ~2-minute averages) and edge logs, relayed by the owner; NOT read by the operator. The operator separately saw 16 connections / 1 active at 14:28:41 | P |

## H3-only acceptance (packet 5.2)
| Item | Value |
| --- | --- |
| Counts toward the gate? | **No.** Run on owner GO as a diagnostic attempt after NO-GO ramp stages; it also fails the gate thresholds |
| p99 write / read | 3187 ms / 8387 ms (> 10 s needs a written explanation: no individual p99 above 9.5 s; max single read ~9.5 s p99 by role) |
| Public page p95; 5xx; submissions | page p95 470 ms (p99 1595) for 150 of 150; no 5xx; 16 of 16 submissions succeeded (p95 2180 ms); delegates created no Auth session |
| PT409 conflicts | 4 (apply_conference_mutation 409s in the API log) = 0.24 per 100 writes; all 4 remained as conflictsAtClose; none appeared as lost or duplicated |
| Recovery | outbox NOT drained (181 pending at close); database connections back to 16 total / 1 active within ~40 s |
| Isolation | fingerprint identical; no other conference changed; all writes in fixture B (+1654 operational changes, +16 documents, +121 roll calls) |

## Read latency by role (aggregate p50 / p95 / p99, ms)
admins 4340 / 8080 / 9464; approval 3647 / 6028 / 8396; chair 1516 / 5179 / 6943; executive 2387 / 7977 / 9525. For comparison at low load (R2, 50 staff) chair refresh p50 was about 390 ms and executive about 1050 ms.

## Work done vs plan (planned counts from PF19 plan-h3.json)
Planned 2840 server writes. Runner-acknowledged writes 1642 plus 181 still pending at close (about 64 % of plan if all had been applied). Observed vs planned: rollCall 121 of 128; queueAdd 536 of 1385; speechStart 189 of 252; speechScore 180 of 240; poiAdd 75 of 95; approve 34 of 196; print 38 of 59; sendToApproval 16 of 32. So the run did not complete the planned work in 30 minutes; whether this is because slow refreshes delayed scripted steps or because steps were skipped for lack of eligible documents is not established.

## Runner host (local sampler, 192 samples)
Peak runner CPU 39.4 % of one core (14:17:11), mean 11.1 %, 0 samples at or above 95 %; load average peak 0.57 on 4 cores; peak established TCP 64; peak RSS 1411 MB (growing through the run); 16 GB RAM free. The generator host was not the bottleneck.

STOP conditions: the watcher's CPU readings met STOP row 4 (> 90 % for 2 consecutive minutes: 98.4 % at 14:11-14:13); **the owner waived it**, so no STOP was given and the operator did not interrupt. Latency STOP row 3 (read p95 > 8 s for 3 consecutive minutes): per the watcher's per-minute table, read p95 reached about 8 s in two minutes (14:18, 14:24) but never for 3 consecutive minutes (final per-minute summary from the watcher still to be filed). Several \"STOP\" thresholds in section 6 were exceeded on the measured numbers though they depend on a watcher: row 3 (read p95 > 8 s for 3 consecutive minutes) is plausible at admins/executive p95 8080/7977 ms for the whole run, but per-minute p95 is not in the report. The watcher/owner owns that call.

**H3: NO-GO** (diagnostic attempt after NO-GO ramp) - decided by Claude, 14:29 UTC. Fails C4, C5, C6 and C8 (CPU, per the watcher). Not a gate pass. Nothing was rerun.


## Watcher final summary (peak minutes, recovery, call table) - source: the watcher's final summary (monitor feed, Postgres/Auth/edge logs and SQL reads), relayed by the owner; not read by the operator
- **Peaks (CPU and memory are ~2-minute averages):** CPU 98.4 % at 14:11:27-14:13:27 (waived by the owner); memory 65.0 % (14:24:52 reading); connections 38 (pg_stat_activity), 37 on the monitor; swap 0; pooler waiting 0.
- **Per-minute read p95:** highest **8,350 ms at 14:18**, second highest 8,116 ms at 14:24. Over 8 s in two minutes, neither consecutive, so latency STOP row 3 (3 consecutive minutes) was **not** met.
- **Per-minute write p95:** highest **2,893 ms at 14:09**. Longest single request 12.4 s at 14:12 (STOP row 3's 30 s single-request limit not met). These per-minute figures differ slightly from the live ones because later-arriving logs changed them.
- **Totals (watcher's log count, whole run):** 12,397 requests, 0 5xx, 0 429, 4 x 409 conflicts; no 57014, 40001, PGRST003 or rate-limit codes in the Postgres and Auth logs.
- **Recovery (window to 14:38:04 UTC):** monitor 14:33:52 CPU 0.9 %, memory 28.4 %, connections 9 of 90, pooler waiting 0; 14:35:52 CPU 3.5 %, memory 26.4 %, connections 8; 14:37:52 CPU 0.7 %, memory 26.4 %, swap 0, connections 8-9, lock waits 0, 0 active backends. Back at the 13:36-13:37 baseline (CPU 5.2 %, memory 24.2 %, connections 6-8). No ALERT.
- **Server-side call table (14:31:45 snapshot minus 13:55:29 baseline):** conference_state_snapshot 9,560 calls, mean 1,947 ms, max 5,453 ms; executive_state_snapshot 1,008 calls, mean 2,296 ms, max 7,316 ms; apply_conference_mutation 1,715 calls, mean 35.6 ms, max 449.7 ms; submit_resolution 16 calls, mean 38.5 ms, max 150.9 ms; submission_link_info 67 calls, mean 3.9 / 7.0 ms, max 22 / 30 ms. **The two snapshot functions, not the mutations, carry the time** (mutation mean 35.6 ms server-side versus 1.9-2.3 s per snapshot call).
- **Fixture B final snapshot size: 1,550,366 bytes, against 232,171 before H3** (about 6.7 times larger). Together with the call table this points to snapshot cost growing with accumulated data and concurrent refreshes; it is a hypothesis, not a proven cause.
- **Cross-check of the operator's cleanup:** the watcher saw active grants on A and B go from 22 to 0 between 14:31:37 and 14:38:02 with change counts unchanged (A 739, B 1,655); that was the operator's revoke-only cleanup (14:36-14:37 UTC, owner-approved), after the run.
