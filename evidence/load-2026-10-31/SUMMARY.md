# DCMUN load window, 31 October 2026 - diagnostic attempt after NO-GO ramp

**Label for every file in this folder: "diagnostic attempt after NO-GO ramp".** The ramp (R3, R3b) was NO-GO, and H3 was run afterwards as a diagnostic attempt on the owner's explicit GO. It is a departure from the run sheet, not a gate run. Prepared by Claude (harness operator and, from S0 on the owner's instruction, go/no-go decider). STOP authority: the owner; no STOP was given (the watcher's CPU readings met STOP row 4 during H3 and the owner waived it). Commit under test 288c723, Preview deployment dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR, project kllhswucdhqqywnzxado, run id load-2026-10-31.

## Result in one paragraph
Stages S0, R1 (with a recorded deviation) and R2 (25 and 50 staff) passed on every measured check. At 80 staff (R3 and its rerun R3b) read latency exceeded the 2,500 ms limit, and R3 also exceeded the write limit, so the ramp ended with a real NO-GO. H3 (110 staff plus the public burst, 30 minutes) was then run as a diagnostic attempt: it **did not pass** (write p95 2,726 ms, read p95 6,215 ms, 181 actions pending and 4 conflicts at close after a 120 s drain, and Postgres CPU of 80 to 98 % per the watcher). The application stayed up and consistent in every stage: 0 duplicates, 0 lost acknowledged writes, 0 error responses, 0 rate limits, no 5xx, no Postgres errors, original conference untouched. **H3 does not count toward the gate.**

## Go / no-go table
| Stage | Staff / min | Fixture | Label | Decision | Decided (UTC) | By | Write p95 / read p95 (ms) | Exit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S0 | 10 / 5 | A | RAMP / DIAGNOSTIC ONLY | GO | 12:48 | Claude, on owner instruction | 856 / 1,166 | 0 |
| R1 | 25 / 5 | A | RAMP / DIAGNOSTIC ONLY | NO-GO on one check (sendToApproval); accepted as a ramp step with a recorded deviation | 12:55, owner decision after | Claude; owner accepted | 876 / 1,197 | 1 |
| R2 | 50 / 5 | A | RAMP / DIAGNOSTIC ONLY (READINESS RUN structurally) | GO | 13:07 | Claude, on owner instruction | 834 / 2,057 | 0 |
| R3 | 80 / 5 | A | RAMP / DIAGNOSTIC ONLY | **NO-GO** (write p95, read p95; also sendToApproval) | 13:42 | Claude, on the owner's rule | 2,294 / 4,459 | 1 |
| R3b (rerun, owner approval ~13:50) | 80 / 5 | A | RAMP / DIAGNOSTIC ONLY | **NO-GO** (read p95; also sendToApproval) | 13:51 | Claude, on the owner's rule | 1,086 / 3,442 | 1 |
| H3 (diagnostic attempt after NO-GO ramp) | 110 + 150 pages, 16 submissions / 30 | B | READINESS RUN (configured); gate not passed | **NO-GO** (write p95, read p95, pending at close, Postgres CPU) | 14:29 | Claude | 2,726 (worst action) / 6,215 | 1 |

## Gate verdict and whether H3 counts
`conferenceGate` for H3: eligible true, pass **false**. H3 does not count toward the gate: it failed the thresholds and was run after NO-GO ramp stages as an owner-approved diagnostic departure from the run sheet (owner GO ~13:50 UTC, this chat). The direct-RPC write path was the approved release path (RELEASE_SCOPE_2026-10-26.md), so path was not the reason.

## What held in every stage
Duplicates 0, lost acknowledged writes 0, error rate 0 %, rate-limited 0, no 5xx or Postgres error entries in the Supabase and Vercel logs, original-conference fingerprint identical to the baseline after every stage (24 changes, last change 2026-10-25 23:43:50 UTC, 11 active grants, 1 document, 2 attendance, 30 audit rows), no other conference changed. Public form in H3: 150 of 150 page loads (p95 470 ms), 16 of 16 submissions, no delegate Auth sessions. After H3 the database was back to 16 connections within ~40 s.

## What failed and the numbers
- **Read latency grows with staff:** read p95 1,166 / 1,197 / 2,057 / 4,459 (3,442 on rerun) / 6,215 ms at 10 / 25 / 50 / 80 (twice) / 110 staff, against a limit of 2,500. Medians at low load are ~400 ms (chair) and ~1,050 ms (executive); in H3 the read p50 was 2,197 ms.
- **Tail:** in R3 and R3b individual reads reached 4-6 s while medians were normal; spot reads of the database showed up to 31 of 43 connections active at once at three moments in H3 (14:03, 14:11, 14:22) and 19 in R3, consistent with bursts of simultaneous snapshot reads. This is a hypothesis, not a diagnosis.
- **Generator host ruled out:** runner peaked at 13.0 % (R3b) and 39.4 % (H3) of one core, never near 95 %; load average at most 0.57 on 4 cores.
- **H3 outbox:** 181 pending and 4 unresolved PT409 conflicts at close; 1,642 writes acknowledged of 2,840 planned; work completed fell well short of plan (queueAdd 536 of 1,385; approve 34 of 196). Nothing was reported lost or duplicated, but the planned workload was not completed.
- **R3 write p95 (2,294 ms) did not recur in R3b (1,086 ms);** the read tail did.

## Watcher's final summary - what it adds (source: the watcher's final summary (monitor feed, Postgres/Auth/edge logs and SQL reads), relayed by the owner; not read by the operator)
- **Per-minute peaks in H3:** read p95 8,350 ms at 14:18 (8,116 ms at 14:24), write p95 2,893 ms at 14:09, longest request 12.4 s at 14:12. Read p95 exceeded 8 s in two non-consecutive minutes, so latency STOP row 3 was not met. CPU met STOP row 4 (98.4 % at 14:11-14:13), waived by the owner.
- **Where the time goes:** server-side, `conference_state_snapshot` averaged 1,947 ms per call (9,560 calls) and `executive_state_snapshot` 2,296 ms (1,008 calls), while `apply_conference_mutation` averaged 35.6 ms (1,715 calls). Fixture B's snapshot grew from 232,171 to 1,550,366 bytes during H3. The read path (full snapshot per refresh, ~6.4 reads per write) is the dominant cost; this fits the read-p95 growth with staff count and the CPU saturation at 110 staff, but it is a hypothesis to test, not a proven cause.
- **Recovery:** the system was back to the 13:36-13:37 baseline by 14:33-14:37 (CPU < 4 %, memory 26-28 %, 8-9 connections, 0 lock waits). No ALERT during the recovery window.
- **H3 totals (watcher):** 12,397 requests, 0 5xx, 0 429, 4 x 409; no 57014, 40001, PGRST003 or rate-limit codes.

## Deviations
1. **R1 (owner-accepted):** "NO-GO under C-rule solely on sendToApproval not observed; all safety checks passed; likely cause: GA1/GA3 had no Draft left after S0." Confirmed read-only: S0 and R1 both targeted GA1 and GA3; both had 0 Drafts after S0. Fixture data was not edited. The same cause produced the sendToApproval miss in R3 and R3b (C17's Draft was consumed in R2).
2. **R3b** is a rerun of R3 with diagnostics on the owner's approval; R3 evidence is unchanged.
3. **H3** ran after NO-GO stages as a diagnostic attempt on the owner's GO.
4. **Decider changed:** the owner moved the go/no-go decision from Zuhayr Siddique to Claude from S0 (run sheet section 1 updated).
5. **Fixtures applied by the Approver in the SQL editor,** not through the connector (file too large to retype safely).
6. **Pre-flight (per owner):** PF7 Small confirmed by owner; PF8 synthetic data only, owner accepts; PF22 not applicable (cloud operator); PF2 merge-commit CI not found, local run at the SHA passed; PF9 dashboard Auth limit not read by the operator.
Review items D1-D8 are in docs/LOAD_WINDOW_REVIEW_2026-10-28.md; the owner approved them as written on 30 Oct.

## What the operator did not read, and where the values came from
The operator cannot read the Supabase Observability dashboards. The values below for C8, C9 (dashboard), C10 and C13 were **not read by the operator**; they come from the watcher's metrics feed (node-wide CPU, about 2-minute averages) and edge logs, relayed by the owner on 31 Oct after the run, and are recorded as such in each stage's go-no-go.md.
- **C8 Postgres CPU:** R3b peak 51 % (pass). R3: **not measured** (the watcher's monitor started at 13:41, after R3's window). **H3: fail** - readings of 80 to 98 % across several minutes, 98.4 % at 14:11-14:13. That meets STOP row 4 (> 90 % for 2 consecutive minutes); **the owner waived it**, so no STOP was given and the run was not interrupted. S0, R1, R2: **no value was provided; recorded "not read"**.
- **C9 connections (H3):** direct connections 36 to 38; spot peak 44 of 90 (pass). The 44 is the operator's own spot read. Other stages: operator spot samples only (peak 43 in R3 and R3b, 34 in R2, 24 in R1).
- **C10 memory/IO (H3):** memory peak 64.7 %, swap 0, Disk IO balance 99 % (pass). Other stages: no value provided, "not read".
- **C13 settle (H3):** at 14:29:52 UTC (about 2 minutes after the end): CPU 3.7 %, memory 26 %, 9 connections, 0 lock waits (pass). Other stages: not timed.
- **Per-minute p95 / latency STOP rows (H3):** per the watcher's per-minute table, read p95 reached about 8 s in two minutes (14:18, 14:24) but never for 3 consecutive minutes, so latency STOP row 3 was not met. The watcher's final per-minute summary is still to be filed.
- **Not produced:** dashboard screenshots (none were produced).
- **The operator applied only these writes during the window:** one GA1 submission link on fixture B (through the app's own transport) and, at the end, the two revoke-only cleanups under owner approval. Fixtures A and B were applied by the Approver in the SQL editor.
- **Independent reviewer** sign-off: not done; release approver not involved.

## Cleanup and retirement
Revoke-only cleanup of fixtures A and B was **applied by the operator with execute_sql under owner approval at 14:36-14:37 UTC** (files retyped exactly): both now show 0 active grants, submission links, amendment links and credentials; every other conference, including the original (11 active grants), is identical to the pre-cleanup snapshot; the original fingerprint is unchanged. Details: cleanup/. Final retirement list: cleanup/retirement-pending.md (NOT DONE).

## Sign-off
| Role | Name | Signature / initials | UTC |
| --- | --- | --- | --- |
| Harness operator | Claude | operated and recorded; not a human signature | |
| Dashboard watcher | separate watcher session / owner | not recorded | |
| Go/no-go decider | Claude on owner instruction | recorded per stage | |
| Independent reviewer | | not done | |
| Approver (Zuhayr Siddique) | | pending | |
