# DCMUN load window run sheet — 31 October 2026 (fill-in copy)

**PREPARED; NOT RUN. NOTHING ON THIS SHEET HAS BEEN EXECUTED.** This is the paper (or markdown) record for the operator and the dashboard watcher. It adds no approval, no threshold and no command of its own: the owner's [run card](LOAD_WINDOW_2026-10-31.md) and the [execution packet](LOAD_TEST_EXECUTION_PACKET.md) govern, and every number below is copied from them (packet section references in brackets, for example [4.1 C8]). Where this sheet departs from the card, it says so and cites [the 28 October review](LOAD_WINDOW_REVIEW_2026-10-28.md) as D1 to D8; the owner decides each departure before the day.

**Rules for this sheet.** Fill it in live, in UTC (Qatar time is UTC+3: 16:00 Qatar = 13:00 UTC, 18:00 Qatar = 15:00 UTC). Never write a secret, access code, token, key, identity or session file, or the submission link, on it or in the evidence folder (section 10). Refer to them as `$PREVIEW`, `$A`, `$B`, `$SUBMIT_TOKEN`, `$VERCEL_AUTOMATION_BYPASS_SECRET`. A blank GO line means NO-GO. The runner has no auto-abort; only a person calls STOP.

Commit under test (tooling): `________________`   App candidate / Preview deployment id: `________________`   Run id: `load-2026-10-31`

## 1. Roles (record before GO)

| Role [packet 1] | Holder (name) | Contact / channel | Present at (UTC) | Confirmed by |
| --- | --- | --- | --- | --- |
| Approver and stop authority (Zuhayr Siddique; applies or approves every hosted SQL; Small upgrade and cost) | Zuhayr Siddique (overseer; terminates the test when told to) | this chat | 31 Oct, from pre-flight | Owner, 30 Oct; 31 Oct (Small upgrade done) |
| Harness operator (runs `npm run rehearsal:*`, holds `.test-sessions/`, fills this sheet) | Claude (AI operator, cloud session). Operates only; never decides GO | this chat | 31 Oct, from pre-flight | Owner, 31 Oct |
| Dashboard watcher (Supabase Observability and logs, Vercel logs; **calls STOP**) [card: confirm before GO] | Zuhayr Siddique | this chat | 31 Oct, from pre-flight | Owner, 31 Oct |
| Go/no-go decider and settle timer (not the operator alone) | Zuhayr Siddique | this chat | 31 Oct, from pre-flight | Owner, 31 Oct |
| Independent reviewer (reviews the report and every stop/go) |  |  |  |  |
| Release approver (John Paul Ribeiru): not involved in running |  |  |  |  |

**STOP communication channel** (a voice call or chat the watcher can use in under 10 seconds; the operator stays on it): `this chat`   **Owner on-call contact during the window:** `Zuhayr Siddique, this chat`

**Role arrangement (owner, 31 Oct).** Zuhayr Siddique holds the Approver and stop authority, dashboard watcher and go/no-go decider roles. Claude operates only and never decides GO. On "STOP" in this chat the operator interrupts the runner immediately and confirms with `pgrep -f rehearsal-run` (prints nothing). No fixture SQL is applied until Zuhayr confirms in this chat. The independent reviewer and release approver rows are unchanged and not filled by this arrangement.

## 2. GO and STOP record

### 2.1 Pre-run GO (all of section 4 passed; the decider and the owner agree)

| Item | Value |
| --- | --- |
| All section 4 rows PASS (initials) |  |
| Owner written approval reference (names the packet commit) [P1] | Owner message, 30 Oct 2026 (PF0); commit: `________________` |
| PRE-RUN GO at (UTC) / by |  |
| Owner present / reachable at (UTC) |  |
| Window start 13:00 UTC; **H3 must not start after 14:10 UTC (17:10 Qatar)**; hard stop 15:00 UTC (18:00 Qatar) |  |

### 2.2 STOP record (fill one block per STOP; also write it in section 8)

| Field | Value |
| --- | --- |
| Time STOP called (UTC) / by |  |
| Condition number (section 6) and the exact reading |  |
| Operator pressed Ctrl-C at (UTC); harness process confirmed gone (`pgrep -f rehearsal-run` prints nothing) |  |
| Owner told at (UTC) / by |  |
| Per-fixture revoke-only cleanup started at (UTC) (section 9) |  |
| Last good metrics (copy from section 7) |  |
| Do **not** restart on the same fixture or continue the ramp; a new attempt needs a new approval for the changed scope [7] |  |

## 3. Time plan (card; Qatar / UTC)

Times are the card's suggestions, not promises. If any step runs late, stop or revise with the owner; do not skip a failed stage, extend beyond 18:00 or run an unapproved contingency. Review D2 and D6 explain why the R3 and ramp slots are tight; record below what was actually decided.

| Qatar | UTC | Step | Actual start (UTC) | Actual end (UTC) |
| --- | --- | --- | --- | --- |
| 16:00-16:10 | 13:00-13:10 | Final target / configuration / Small / backup / fixture / watcher checks |  |  |
| 16:10-16:20 | 13:10-13:20 | S0: 10 staff, 5 min, bounded drain, manual settle/GO |  |  |
| 16:20-16:30 | 13:20-13:30 | R1: 25 staff, same sequence |  |  |
| 16:30-16:40 | 13:30-13:40 | R2: 50 staff, same sequence |  |  |
| 16:40-16:50 | 13:40-13:50 | R3: 80 staff, settle/GO. Fresh B setup per the card, **but see D2: do it before 16:00** |  |  |
| 16:50-17:22 | 13:50-14:22 | H3: 110 staff + public burst, 30 min + up to 2 min drain (start-up and final read add about 1 to 2 min) |  |  |
| 17:22-18:00 | 14:22-15:00 | Recovery observation (H5, 10 min), approved browser/Realtime/voting checks if time permits, evidence review, **revoke-only cleanup** |  |  |

Decision on where fixture B is created (D2): **`before 16:00`** (the review's proposal)   Decided by / at: owner, 30 Oct (approved D1 to D8 as written)

## 3a. What changed with the session model (read before PF3a)

With PRs #84 and #88 merged (#88 replaced #87), the runner exercises the new model. Chairs no longer choose a session and no longer write attendance mark by mark. A Chair builds a roll call on the device (a `draft`, which sends nothing) and commits it whole (`rollCallCommit`). The H3 plan (`rehearsal:plan` with PF19's arguments) changes only there: **128** roll call commits replace **1,127** attendance writes and **22** session selections. Roles (75/20/10/5) and the public burst (150 page loads, **16** submissions) are unchanged. Since PR #89 the plan counts only server writes (drafts and timers stay on the device): `staffApp.writes` **2,840** (95 per minute), at most **2.8** writes per user per minute. Results are not directly comparable with earlier evidence that included attendance writes; record this in the summary.

**Pre-checked 30 Oct (read-only, from the preparation session).** Staging has all seven session-model migrations (PF3b; the stored text of each matches the repository file), attendance was converted into 6 legacy roll calls (41 rows), `timers` is gone and no conference has hold enforcement on (PF3c). Re-read both on the day; this note is not the evidence.

## 4. Pre-flight table (complete before fixtures and S0; `Local` rows contact no network)

Evidence names are files in the evidence folder (section 10). "P" numbers are the packet's pre-flight IDs.

| ID | Check | How to verify | Expected | Evidence file | Result (PASS/FAIL) | Initials / UTC |
| --- | --- | --- | --- | --- | --- | --- |
| PF0 | Written owner approval of the exact commands, the window (UTC and Qatar), the people and the write path [P1, P17]. **Given 30 Oct** (owner message in the preparation session): approves this sheet as merged, its commands, the window, the people, the direct-RPC write path and the review's proposals D1 to D8 as written | VERIFICATION.md entry or owner message; names the packet commit SHA. Write path stated: direct RPC, owner decision 26 Oct (RELEASE_SCOPE_2026-10-26.md) | Exists and names the SHA | `preflight/preflight-record.md` |  |  |
| PF1 | Real conference data absent; no real Executive bootstrapped [P2] | Owner statement | Confirmed in writing | `preflight/preflight-record.md` |  |  |
| PF2 | **Local** tooling revision frozen and green | `git rev-parse HEAD`; `npm run typecheck`; `npm run typecheck:rehearsal`; `npm run lint`; `npm test`; `npm run check:grants`; CI green on the same SHA | SHA recorded; all pass | `preflight/preflight-record.md` |  |  |
| PF3 | Preview is the intended app revision and is not Production [P11] | Vercel dashboard (deployment id, commit SHA, Preview, target null); open `<preview>/api/health` (needs the bypass secret in the browser or the runner) | `environment` is `preview`; build id matches; Supabase, database and Storage `ok`; server key points at this project | `preflight/preflight-record.md` |  |  |
| PF3a | **Session model under test.** The tooling SHA (PF2) and the Preview (PF3) contain the session model: PR #84 (committee live state, roll calls, ballot snapshots) and PR #88 (hold dependencies, attendance conversion, `timers` dropped; it replaced #87) are merged to `main` | `git merge-base --is-ancestor c9e6a64 HEAD && echo yes` (`c9e6a64` is the #88 merge commit); the Preview's commit SHA is the same or later | `yes`; SHAs recorded. If either PR is not merged, the window runs the previous model and its results are not evidence for the session model: record which | `preflight/preflight-record.md` |  |  |
| PF3b | **Staging schema matches the tooling.** The session-model migrations are applied to the staging project before any fixture | Dashboard, Database, Migrations (or read-only `select version from supabase_migrations.schema_migrations order by version desc limit 8`) | Present: `20261029100000` session_window, `20261029110000` session_schedule, `20261030090000` record_labelling, `20261030100000` session_holds, `20261030110000` session_schedules_snapshot, `20261031090000` committee_live_state, `20261031100000` attendance_to_roll_calls | `preflight/migrations.txt` |  |  |
| PF3c | **Hold enforcement off for the fixtures** (the default). The load run measures the normal write path; with enforcement on, stale or uncertain actions would be parked for review and the exactly-once read would not match | Read-only `select conference_id, hold_enforcement from private.conference_settings where conference_id in (<A>, <B>)` | No row, or `hold_enforcement = false` | `preflight/preflight-record.md` |  |  |
| PF4 | **Local** target guard output [P3]. Run the packet P3 command exactly (unescaped) | Packet section 2, row P3 | `{"ok":true,"ref":"kllhswucdhqqywnzxado","shellUrlDiffers":false}` and exit 0 | `preflight/target-guard.json` |  |  |
| PF5 | **Local** shell configuration [P4, P5] | `printenv EXPECTED_SUPABASE_REF` prints nothing; `printenv STAGING_SUPABASE_REFS DEVELOPMENT_SUPABASE_REFS` lists the ref in exactly one; `NEXT_PUBLIC_CONFERENCE_ID` = `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`; `PROTECTED_CONFERENCE_IDS` holds the 21 Oct temporary conference, **and (proposed, D5) `ac63e049-b89d-40c6-88a4-f635dd6fad80`**; each a UUID | As stated; do not paste the values that are not UUIDs | `preflight/preflight-record.md` |  |  |
| PF6 | **Local** bypass secret present in the shell only, if the Preview is protected [P12, D1] | `[ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ] && echo set` (never print it) | `set`; in no file | `preflight/preflight-record.md` ("set"/"not needed") |  |  |
| PF7 | Pro and **Small** compute confirmed; no resize or restart in progress [P8] | Dashboard: Organisation, Billing (Pro); Project, Settings, Compute and Disk (Small, disk size). Upgrade, if still needed, is the owner's and happens well before 16:00 (it restarts the database). **Owner, 30 Oct: upgrades to Small on the morning of 31 Oct** | "Small" visible; dated screenshot (crop out keys). If Micro, only L0/S0 with approval, never the gate | `preflight/compute-pitr.png` and a line in the record |  |  |
| PF8 | Backups and PITR state recorded [P9] | Dashboard, Database, Backups. Card: Micro, next renewal 20 Nov, latest successful daily backup 25 Oct 23:26:28 UTC, PITR off (recheck today). **Owner, 30 Oct: staging holds synthetic data only; there is no data to lose** | Latest backup time and PITR state written down; owner has noted the data-loss position (no approval is implied by PITR being off) | `preflight/preflight-record.md` |  |  |
| PF9 | Auth anonymous sign-in limit and this network [P10] | Dashboard, Authentication, Rate limits (card: 30 per hour). Count anonymous sign-ins from this IP in the last hour (Auth logs): expected 0 before preparation; planned total **23** (22 pool + 1 prepare-session) | Limit recorded; hour count recorded; 23 + hour count <= 30 | `preflight/preflight-record.md` |  |  |
| PF10 | Lifecycle marker accepted [lifecycle preflight] | Every tool (`prepare-session`, `rehearsal-identities`, `rehearsal-run`) refuses unless `preproduction_status` is preproduction/rehearsal, `canTest=true`, revision >= 1, ref matches. Record "accepted" when PF11 starts. Optional manual read of the same anonymous RPC (publishable key from `.env.local`; do not paste it): `curl -sS -X POST "$URL/rest/v1/rpc/preproduction_status" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}'` | 26 Oct record: preproduction, revision 1, canTest true, ref `kllhswucdhqqywnzxado` | `preflight/preflight-record.md` |  |  |
| PF11 | Session prerequisites exist [P7, D5] | `ls supabase/fixture-ids.json .test-sessions/development.json`; if the second is missing run `npx tsx scripts/prepare-session.mts` (one sign-in; a saved file is only refreshed) | Both present; output `{"userId":...,"project":"kllhswucdhqqywnzxado"}` (record the project only) | `preflight/preflight-record.md` |  |  |
| PF12 | Identity pool: 19 Chair + Approval + Admins + Executive = **22** sessions | `npm run rehearsal:identities -- --chairs 19` (about 7 min when creating; refresh-only when the files exist) | Exit 0; `pendingNextRun` 0; record `created`/`refreshed` counts (created <= 25). Exit 3 means some were skipped: stop and wait an hour | `preflight/preflight-record.md` |  |  |
| PF13 | Fixture A generated (**local**, no network): 19 committees, 420 assumed delegates, 3-hour grants | `npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 19 --delegates 420 --grant-hours 3` | JSON: `readinessFixture` true, `committees` 19, `chairGrants` 19, `distinctChairUsers` 19, `delegatesInFixtureJson` 420. Record the conference UUID (a UUID is allowed) as fixture A's id, then set `$A` to its directory, as the packet does: `export A=".test-sessions/fixtures/<conference-A-uuid>"`; check `ls $A/fixture.sql $A/identities.json` | `preflight/preflight-record.md` |  |  |
| PF14 | **Local** review of fixture A SQL; fixture conference differs from both protected ids [P6] | Read `$A/fixture.sql` and `$A/cleanup.sql`: one conference id throughout, 19 committees, 22 grants (19 Chair + 3 role), no Auth or secret content. Compare the UUID with the protected ids | As stated; UUIDs differ | `preflight/preflight-record.md` |  |  |
| PF15 | Baseline fingerprint of the original conference and Advisors recorded [P13] | SQL editor, read-only, query in LOAD_TEST_PLAN.md "Isolation checks" (replace `<ORIG>`). Dashboard Advisors (performance, security). **Owner agrees not to write to the original or owner-review conference 16:00-18:00 (D5.5)** | Output saved unchanged; Advisors noted | `preflight/fingerprint-before.txt` |  |  |
| PF16 | Fixture A applied by the Approver [3.2 step 3] | SQL editor (or approved scoped connector run); hosted write: needs PF0 | Succeeds; fingerprint (PF15) still equal | `preflight/preflight-record.md` |  |  |
| PF17 | Payload probe on A (hosted, read-only) [3.2 step 4] | `npx tsx scripts/rehearsal-snapshots.mts --identities $A/identities.json --fixture $A/fixture.json --all-chairs` (about 440 sequential reads; allow 2 to 3 min) | `failures` 0 for every role; record bytes and p50/p95 per role | `preflight/payload-snapshots.json` |  |  |
| PF18 | Fixture B generated, reviewed, applied; **resolution link for GA1 created**; `SUBMIT_TOKEN` set in the shell only [3.3, D2] | `npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 19 --delegates 420 --grant-hours 4`; review SQL as PF14; Approver applies; create the link on the Preview as the fixture Executive (method must have been rehearsed on Micro [Untested, 3.3]); `export SUBMIT_TOKEN=...` without echoing it | Same JSON as PF13 with `grantHours` 4; B UUID differs from A and the protected ids; `export B=".test-sessions/fixtures/<conference-B-uuid>"` (the directory, not the UUID) and `ls $B/fixture.sql $B/identities.json`; fingerprint unchanged; `[ -n "$SUBMIT_TOKEN" ] && echo set` | `preflight/preflight-record.md` (UUID of B; never the token) |  |  |
| PF19 | **Local** plan check [packet 6] | Run the packet section 6 `buildScenario` one-liner (or `npm run rehearsal:plan -- --staff 110 --staff-profile dcmun-2026 --delegates 150 --minutes 30 --committees 19 --submit-fraction 0.08`) | roles 75/20/10/5; `pageLoads`/`submitPage` 150; `submit` **16** | `preflight/plan-h3.json` (add to the folder; optional) |  |  |
| PF20 | Dashboards open; baseline readings logged [P14] | Supabase Observability (CPU, memory, disk IO, connections), API, Postgres, Auth, Realtime logs; Vercel Logs and Functions; range "last 30 minutes", auto-refresh; API log filtered for 429, 5xx, `PGRST003`, `40001`, `57014` | Watcher confirms; two baseline rows in section 7 at T-10 and T-1 min | section 7 / `dashboard/metrics-log.csv` |  |  |
| PF21 | Stop authority and channel named [P15]; people in section 1 filled | Section 1 | Named | this sheet |  |  |
| PF22 | Operator machine ready (D3 in the review: non-product failure sources) | Wired network, mains power, sleep and screen lock disabled, no VPN change, clock synchronised, one stable egress IP, nothing else heavy running; note CPU idle % | Recorded | `preflight/preflight-record.md` |  |  |
| PF23 | **Token freshness (D3): refresh all 22 pool sessions within 5 minutes before S0, and again within 5 minutes before H3** | `npm run rehearsal:identities -- --chairs 19` (existing files only refresh; expect `created` 0, `refreshed` 22, exit 0). Record time | Done before S0 at ____ UTC and before H3 at ____ UTC | `preflight/preflight-record.md` |  |  |
| PF24 | Evidence folder created and the checker runs [section 10] | `mkdir -p evidence/load-2026-10-31/{preflight,dashboard,incidents,cleanup}` then `npm run check:load-evidence -- evidence/load-2026-10-31 --allow-incomplete` | Exit 0, no FORBIDDEN lines | this sheet |  |  |

## 5. Stages

One invocation per stage, **never `--stages`**. The shell has `PREVIEW`, `A`, `B`, `SUBMIT_TOKEN` (and the bypass secret when needed) set privately. Run from the repository root. After every stage the decider records GO or NO-GO; **a NO-GO ends the ramp**. Pass criteria, runner (enforced at the end, once) and operator (human) checks are in [packet 4.1 and 5.2]. Expected report fields: `staffProfile`, `staffRolesPerStage`, `diagnosticVerdict.pass`, `conferenceGate.eligible`/`pass`, `readinessLabel`, `readiness.label`, `capacityGate`, `exactlyOnce`, `stages[0].pendingAtClose`/`conflictsAtClose`/`unconfirmedAtClose`/`closeTimedOut`/`drainSeconds`/`observed`/`work`.

After the run, copy the report without its samples: `jq 'del(.samples)' .test-sessions/rehearsal-<time>.json > evidence/load-2026-10-31/stage-<ID>/report.json`. Keep the original private.

### 5.1 S0: 10 staff, 5 minutes (fixture A)

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" --fixture "$A/fixture.json" \
  --staff-profile dcmun-2026 --staff 10 --minutes 5
```

| Expected before any request | Seen (Y/N) |
| --- | --- |
| Printed JSON: `staffProfile` `dcmun-2026`, `staffRolesPerStage` 6/2/1/1 (Chair/Approval/Admins/Executive) |  |

| Expected in the report | Seen |
| --- | --- |
| Chair committees configured: 6 of 19 (report says NOT A READINESS RUN) |  |
| `capacityGate`: "BELOW the 50-staff comparison (smoke / warm-up only)" |  |
| Fixture used / conference UUID | $A =  |
| Commit SHA / Preview deployment id |  |

| Timer | UTC |
| --- | --- |
| Command entered |  |
| Runner "Stage: ..." line printed (t0 is about 1 s later) |  |
| Scenario end expected (t0 + minutes) |  |
| Report written / `drainSeconds` |  |
| Settle started (C13) / baseline reached |  |
| **S0 GO / NO-GO at** (and by) |  |

| # | Checkpoint (S0) [packet 4.1] | Threshold for GO | Value read | P/F |
| --- | --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` true; `readinessLabel` `RAMP / DIAGNOSTIC ONLY` (expected); exit code 0. Incomplete capacity labels are informational, not failures |  |  |
| C1 | Runner: duplicate writes / lost acknowledged writes (`exactlyOnce`) | 0 and 0 |  |  |
| C2 | Runner: error rate (conflicts and rate-limited excluded) | < 1 % |  |  |
| C3 | Runner: rate-limited (429) responses | 0 |  |  |
| C4 | Runner: worst per-action write p95 | <= 1,500 ms |  |  |
| C5 | Runner: worst per-action read p95 | <= 2,500 ms |  |  |
| C6 | Runner: outboxes settled | `pendingAtClose`, `conflictsAtClose`, `unconfirmedAtClose` all 0; `closeTimedOut` false |  |  |
| C6a | Configured vs observed traffic (`observed`, `configuredReadiness`, `readiness`, `work`) | Every device opened; each configured role read; each writing role accepted >= 1 mutation; Chair work only in configured committees; no local refusals; declared operations observed |  |  |
| C7 | Operator: 5xx, `PGRST003`, `40001`, `57014` in the run window | 0 unexplained |  |  |
| C8 | Operator: Postgres CPU | average < 70 %, no 5-minute window > 85 % |  |  |
| C9 | Operator: database connections (limit read from dashboard: ____; plan figure Small = 90, re-check) | peak < 75 % of the limit (90 -> 67 or fewer) |  |  |
| C10 | Operator: memory and disk IO | no sustained growth or swap; IO budget not depleted |  |  |
| C11 | Operator: original-conference fingerprint (PF15 query) | identical to `fingerprint-before.txt` |  |  |
| C12 | Vercel: 5xx or timeouts on `/api/*`, `/api/health` | 0 |  |  |
| C13 | **Settle 2 min** (timed by the decider): connections idle, CPU and IO near baseline, no `PGRST003`/`40001` | back to baseline within 2 min; if not, one further 3 min, else **STOP** |  |  |

| Stage close | Value |
| --- | --- |
| Any STOP condition (section 6) seen? number / time / action |  |
| Observations / deviations |  |
| Evidence saved: `stage-S0/{command.txt,report.json,go-no-go.md,fingerprint-after.txt}` + dashboard images (yes/no) |  |

### 5.2 R1: 25 staff, 5 minutes (fixture A)

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" --fixture "$A/fixture.json" \
  --staff-profile dcmun-2026 --staff 25 --minutes 5
```

| Expected before any request | Seen (Y/N) |
| --- | --- |
| Printed JSON: `staffProfile` `dcmun-2026`, `staffRolesPerStage` 16/5/3/1 (Chair/Approval/Admins/Executive) |  |

| Expected in the report | Seen |
| --- | --- |
| Chair committees configured: 16 of 19 (NOT A READINESS RUN) |  |
| `capacityGate`: "BELOW the 50-staff comparison (smoke / warm-up only)" |  |
| Fixture used / conference UUID | $A =  |
| Commit SHA / Preview deployment id |  |

| Timer | UTC |
| --- | --- |
| Command entered |  |
| Runner "Stage: ..." line printed (t0 is about 1 s later) |  |
| Scenario end expected (t0 + minutes) |  |
| Report written / `drainSeconds` |  |
| Settle started (C13) / baseline reached |  |
| **R1 GO / NO-GO at** (and by) |  |

| # | Checkpoint (R1) [packet 4.1] | Threshold for GO | Value read | P/F |
| --- | --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` true; `readinessLabel` `RAMP / DIAGNOSTIC ONLY` (expected); exit code 0. Incomplete capacity labels are informational, not failures |  |  |
| C1 | Runner: duplicate writes / lost acknowledged writes (`exactlyOnce`) | 0 and 0 |  |  |
| C2 | Runner: error rate (conflicts and rate-limited excluded) | < 1 % |  |  |
| C3 | Runner: rate-limited (429) responses | 0 |  |  |
| C4 | Runner: worst per-action write p95 | <= 1,500 ms |  |  |
| C5 | Runner: worst per-action read p95 | <= 2,500 ms |  |  |
| C6 | Runner: outboxes settled | `pendingAtClose`, `conflictsAtClose`, `unconfirmedAtClose` all 0; `closeTimedOut` false |  |  |
| C6a | Configured vs observed traffic (`observed`, `configuredReadiness`, `readiness`, `work`) | Every device opened; each configured role read; each writing role accepted >= 1 mutation; Chair work only in configured committees; no local refusals; declared operations observed |  |  |
| C7 | Operator: 5xx, `PGRST003`, `40001`, `57014` in the run window | 0 unexplained |  |  |
| C8 | Operator: Postgres CPU | average < 70 %, no 5-minute window > 85 % |  |  |
| C9 | Operator: database connections (limit read from dashboard: ____; plan figure Small = 90, re-check) | peak < 75 % of the limit (90 -> 67 or fewer) |  |  |
| C10 | Operator: memory and disk IO | no sustained growth or swap; IO budget not depleted |  |  |
| C11 | Operator: original-conference fingerprint (PF15 query) | identical to `fingerprint-before.txt` |  |  |
| C12 | Vercel: 5xx or timeouts on `/api/*`, `/api/health` | 0 |  |  |
| C13 | **Settle 2 min** (timed by the decider): connections idle, CPU and IO near baseline, no `PGRST003`/`40001` | back to baseline within 2 min; if not, one further 3 min, else **STOP** |  |  |

| Stage close | Value |
| --- | --- |
| Any STOP condition (section 6) seen? number / time / action |  |
| Observations / deviations |  |
| Evidence saved: `stage-R1/{command.txt,report.json,go-no-go.md,fingerprint-after.txt}` + dashboard images (yes/no) |  |

### 5.3 R2: 50 staff, 5 minutes (fixture A)

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" --fixture "$A/fixture.json" \
  --staff-profile dcmun-2026 --staff 50 --minutes 5
```

| Expected before any request | Seen (Y/N) |
| --- | --- |
| Printed JSON: `staffProfile` `dcmun-2026`, `staffRolesPerStage` 31/11/5/3 (Chair/Approval/Admins/Executive) |  |

| Expected in the report | Seen |
| --- | --- |
| Chair committees configured: all 19 (`readiness.label` READINESS RUN structurally; run still RAMP / DIAGNOSTIC ONLY) |  |
| `capacityGate`: "BELOW the current 110-device gate (historical 50-staff C2 comparison / ramp step)" |  |
| Fixture used / conference UUID | $A =  |
| Commit SHA / Preview deployment id |  |

| Timer | UTC |
| --- | --- |
| Command entered |  |
| Runner "Stage: ..." line printed (t0 is about 1 s later) |  |
| Scenario end expected (t0 + minutes) |  |
| Report written / `drainSeconds` |  |
| Settle started (C13) / baseline reached |  |
| **R2 GO / NO-GO at** (and by) |  |

| # | Checkpoint (R2) [packet 4.1] | Threshold for GO | Value read | P/F |
| --- | --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` true; `readinessLabel` `RAMP / DIAGNOSTIC ONLY` (expected); exit code 0. Incomplete capacity labels are informational, not failures |  |  |
| C1 | Runner: duplicate writes / lost acknowledged writes (`exactlyOnce`) | 0 and 0 |  |  |
| C2 | Runner: error rate (conflicts and rate-limited excluded) | < 1 % |  |  |
| C3 | Runner: rate-limited (429) responses | 0 |  |  |
| C4 | Runner: worst per-action write p95 | <= 1,500 ms |  |  |
| C5 | Runner: worst per-action read p95 | <= 2,500 ms |  |  |
| C6 | Runner: outboxes settled | `pendingAtClose`, `conflictsAtClose`, `unconfirmedAtClose` all 0; `closeTimedOut` false |  |  |
| C6a | Configured vs observed traffic (`observed`, `configuredReadiness`, `readiness`, `work`) | Every device opened; each configured role read; each writing role accepted >= 1 mutation; Chair work only in configured committees; no local refusals; declared operations observed |  |  |
| C7 | Operator: 5xx, `PGRST003`, `40001`, `57014` in the run window | 0 unexplained |  |  |
| C8 | Operator: Postgres CPU | average < 70 %, no 5-minute window > 85 % |  |  |
| C9 | Operator: database connections (limit read from dashboard: ____; plan figure Small = 90, re-check) | peak < 75 % of the limit (90 -> 67 or fewer) |  |  |
| C10 | Operator: memory and disk IO | no sustained growth or swap; IO budget not depleted |  |  |
| C11 | Operator: original-conference fingerprint (PF15 query) | identical to `fingerprint-before.txt` |  |  |
| C12 | Vercel: 5xx or timeouts on `/api/*`, `/api/health` | 0 |  |  |
| C13 | **Settle 2 min** (timed by the decider): connections idle, CPU and IO near baseline, no `PGRST003`/`40001` | back to baseline within 2 min; if not, one further 3 min, else **STOP** |  |  |

| Stage close | Value |
| --- | --- |
| Any STOP condition (section 6) seen? number / time / action |  |
| Observations / deviations |  |
| Evidence saved: `stage-R2/{command.txt,report.json,go-no-go.md,fingerprint-after.txt}` + dashboard images (yes/no) |  |

### 5.4 R3: 80 staff, 5 minutes (fixture A); then settle/GO

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" --fixture "$A/fixture.json" \
  --staff-profile dcmun-2026 --staff 80 --minutes 5
```

| Expected before any request | Seen (Y/N) |
| --- | --- |
| Printed JSON: `staffProfile` `dcmun-2026`, `staffRolesPerStage` 50/17/9/4 (Chair/Approval/Admins/Executive) |  |

| Expected in the report | Seen |
| --- | --- |
| Chair committees configured: all 19 (as R2) |  |
| `capacityGate`: "BELOW the current 110-device gate (historical 50-staff C2 comparison / ramp step)" |  |
| Fixture used / conference UUID | $A =  |
| Commit SHA / Preview deployment id |  |

| Timer | UTC |
| --- | --- |
| Command entered |  |
| Runner "Stage: ..." line printed (t0 is about 1 s later) |  |
| Scenario end expected (t0 + minutes) |  |
| Report written / `drainSeconds` |  |
| Settle started (C13) / baseline reached |  |
| **R3 GO / NO-GO at** (and by) |  |

| # | Checkpoint (R3) [packet 4.1] | Threshold for GO | Value read | P/F |
| --- | --- | --- | --- | --- |
| G | Gate verdict | `diagnosticVerdict.pass` true; `readinessLabel` `RAMP / DIAGNOSTIC ONLY` (expected); exit code 0. Incomplete capacity labels are informational, not failures |  |  |
| C1 | Runner: duplicate writes / lost acknowledged writes (`exactlyOnce`) | 0 and 0 |  |  |
| C2 | Runner: error rate (conflicts and rate-limited excluded) | < 1 % |  |  |
| C3 | Runner: rate-limited (429) responses | 0 |  |  |
| C4 | Runner: worst per-action write p95 | <= 1,500 ms |  |  |
| C5 | Runner: worst per-action read p95 | <= 2,500 ms |  |  |
| C6 | Runner: outboxes settled | `pendingAtClose`, `conflictsAtClose`, `unconfirmedAtClose` all 0; `closeTimedOut` false |  |  |
| C6a | Configured vs observed traffic (`observed`, `configuredReadiness`, `readiness`, `work`) | Every device opened; each configured role read; each writing role accepted >= 1 mutation; Chair work only in configured committees; no local refusals; declared operations observed |  |  |
| C7 | Operator: 5xx, `PGRST003`, `40001`, `57014` in the run window | 0 unexplained |  |  |
| C8 | Operator: Postgres CPU | average < 70 %, no 5-minute window > 85 % |  |  |
| C9 | Operator: database connections (limit read from dashboard: ____; plan figure Small = 90, re-check) | peak < 75 % of the limit (90 -> 67 or fewer) |  |  |
| C10 | Operator: memory and disk IO | no sustained growth or swap; IO budget not depleted |  |  |
| C11 | Operator: original-conference fingerprint (PF15 query) | identical to `fingerprint-before.txt` |  |  |
| C12 | Vercel: 5xx or timeouts on `/api/*`, `/api/health` | 0 |  |  |
| C13 | **Settle 2 min** (timed by the decider): connections idle, CPU and IO near baseline, no `PGRST003`/`40001` | back to baseline within 2 min; if not, one further 3 min, else **STOP** |  |  |

| Stage close | Value |
| --- | --- |
| Any STOP condition (section 6) seen? number / time / action |  |
| Observations / deviations |  |
| Evidence saved: `stage-R3/{command.txt,report.json,go-no-go.md,fingerprint-after.txt}` + dashboard images (yes/no) |  |

**Latest H3 start: 14:10 UTC (17:10 Qatar).** Time H3 was actually started: `______` UTC. If past 14:10 UTC, H3 does not run; record NO-GO and tell the owner.

### 5.5 H3: 110 staff + public burst, 30 minutes (fixture B, the gate run)

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$B/identities.json" --fixture "$B/fixture.json" \
  --staff-profile dcmun-2026 --staff 110 --minutes 30 --delegates 150 --delegate-window 120 \
  --submit-token "$SUBMIT_TOKEN" --submit-committee GA1 --submit-fraction 0.08
```

| Expected before any request | Seen (Y/N) |
| --- | --- |
| Printed JSON: `staffProfile` `dcmun-2026`, `staffRolesPerStage` 75/20/10/5 (Chair/Approval/Admins/Executive) |  |
| Line: `Stage 110 staff: 150 public page loads, 16 resolution submissions planned on one link (max 18).` **Stop if the count is not exactly 16** (do not edit flags to fix it: the count depends on seed, minutes, committees, fraction and window, D5.3) |  |
| Scheduled at seed 42: page loads 0.176-119.793 s; creates 57.292-282.470 s after t0 (scheduled human steps, not guaranteed traffic) |  |
| Pre-start: PF23 token refresh done within 5 min (D3); `$SUBMIT_TOKEN` set; B baseline fingerprint unchanged |  |

| Expected in the report | Seen |
| --- | --- |
| Chair committees configured: all 19 required |  |
| `capacityGate`: "CURRENT capacity gate size (110 devices; it counts only if the report is also a READINESS RUN across all 19 committees)" |  |
| Fixture used / conference UUID | $B =  |
| Commit SHA / Preview deployment id |  |

| Timer | UTC |
| --- | --- |
| Command entered |  |
| Runner "Stage: ..." line printed (t0 is about 1 s later) |  |
| Scenario end expected (t0 + minutes) |  |
| Report written / `drainSeconds` |  |
| Settle started (C13) / baseline reached |  |
| **H3 GO / NO-GO at** (and by) |  |

| # | Checkpoint (H3) [packet 4.1] | Threshold for GO | Value read | P/F |
| --- | --- | --- | --- | --- |
| G | Gate verdict | `conferenceGate.pass` true; `readinessLabel` `READINESS RUN`; `capacityGate` "CURRENT capacity gate size (110 devices ...)"; exit code 0 |  |  |
| C1 | Runner: duplicate writes / lost acknowledged writes (`exactlyOnce`) | 0 and 0 |  |  |
| C2 | Runner: error rate (conflicts and rate-limited excluded) | < 1 % |  |  |
| C3 | Runner: rate-limited (429) responses | 0 |  |  |
| C4 | Runner: worst per-action write p95 | <= 1,500 ms |  |  |
| C5 | Runner: worst per-action read p95 | <= 2,500 ms |  |  |
| C6 | Runner: outboxes settled | `pendingAtClose`, `conflictsAtClose`, `unconfirmedAtClose` all 0; `closeTimedOut` false |  |  |
| C6a | Configured vs observed traffic (`observed`, `configuredReadiness`, `readiness`, `work`) | Every device opened; each configured role read; each writing role accepted >= 1 mutation; Chair work only in configured committees (**all 19**); 150 pages and 16 creates completed; no local refusals; declared operations observed |  |  |
| C7 | Operator: 5xx, `PGRST003`, `40001`, `57014` in the run window | 0 unexplained |  |  |
| C8 | Operator: Postgres CPU | average < 70 %, no 5-minute window > 85 % |  |  |
| C9 | Operator: database connections (limit read from dashboard: ____; plan figure Small = 90, re-check) | peak < 75 % of the limit (90 -> 67 or fewer) |  |  |
| C10 | Operator: memory and disk IO | no sustained growth or swap; IO budget not depleted |  |  |
| C11 | Operator: original-conference fingerprint (PF15 query) | identical to `fingerprint-before.txt` |  |  |
| C12 | Vercel: 5xx or timeouts on `/api/*`, `/api/health` and `/submit/*` | 0 |  |  |
| C13 | **Settle 2 min** (timed by the decider): connections idle, CPU and IO near baseline, no `PGRST003`/`40001` | back to baseline within 2 min; if not, one further 3 min, else **STOP** |  |  |

| Stage close | Value |
| --- | --- |
| Any STOP condition (section 6) seen? number / time / action |  |
| Observations / deviations |  |
| Evidence saved: `stage-H3/{command.txt,report.json,go-no-go.md,fingerprint-after.txt}` + dashboard images (yes/no) |  |

| H3-only acceptance [packet 5.2] | Threshold | Value | P/F |
| --- | --- | --- | --- |
| Counts toward the gate? | yes only if the direct path is the approved release path (RELEASE_SCOPE_2026-10-26.md); write the reference |  |  |
| p99 write and read | recorded; > 10 s needs a written explanation |  |  |
| Write p95 aggregate | recorded (worst per-action is C4) |  |  |
| Public page p95; 5xx; submissions; delegate Auth activity | p95 <= 2 s; no 5xx; all 16 submissions succeed; no Auth activity from delegates (runner has no page-p95 check: read `submitPage` in the report) |  |  |
| PT409 conflicts | reported per 100 writes; each explainable; none lost |  |  |
| Recovery (H5, 10 min after stop) | outbox drained (runner); connections idle within 5 min (watcher) |  |  |
| Isolation | fingerprint identical; no write outside the fixture conference |  |  |

## 6. STOP thresholds (the Watcher calls STOP; all manual) [packet 7]

On STOP: the operator presses Ctrl-C (discards in-memory outboxes; synthetic data), then section 2.2 and section 9. Tick the row and write the UTC time if it occurred.

| # | Stop on | Exact threshold | Seen? / UTC |
| --- | --- | --- | --- |
| 1 | Any write to a real or original conference | Fingerprint differs, or an API log shows a `conference_id` other than the fixture. Do not resume; notify the owner |  |
| 2 | Error rate (conflicts excluded) | > 2 % in any 60 s window, or > 1 % over 5 minutes |  |
| 3 | Latency | write p95 > 5 s or read p95 > 8 s for 3 consecutive minutes; any single request > 30 s |  |
| 4 | Postgres CPU | > 90 % for 2 consecutive minutes |  |
| 5 | Connections | any `PGRST003`; database connections > 85 % of the limit (90 -> 77 or more); pool fully busy > 60 s |  |
| 6 | Memory and IO | memory > 90 % or swap growing; IO budget depleted or IOPS pinned |  |
| 7 | Server errors | `57014` twice in a window; any `40001`; 5xx burst of 3 or more in 60 s |  |
| 8 | Auth rate limiting | any 429 or `over_request_rate_limit` from Auth (pool is pre-created; do not retry) |  |
| 9 | PostgREST or public-form rate limiting | any 429 on staff routes; any 429 on the public form |  |
| 10 | Wrong target | the guard or health check reports `production`, or the wrong ref appears anywhere |  |
| 11 | Real production surface | anything unexpected on the real Supabase or Vercel production surface (alerts, deployments) |  |
| 12 | Authority | the owner or the person in charge says stop |  |

## 7. Dashboard watcher metric log

**Sample intervals.** Baseline at T-10 min and T-1 min before each stage. During a ramp: **every 60 seconds** from t0 to t0 + 7 min (CPU, connections, API 5xx and error codes, PostgREST latency), then at settle +2 and +5 min. During H3: **every 60 seconds** for CPU, connections, errors, RPC latency and Vercel 5xx (STOP 3 and 4 are consecutive-minute rules); memory, disk IO, Auth and Realtime **every 2 minutes** (or continuous alerts). H5 recovery: every 2 minutes for 10 minutes. Keep the API log filtered for 429, 5xx, `PGRST003`, `40001`, `57014` open the whole time; a single occurrence is logged immediately in section 8, not at the next sample. Copy rows to `dashboard/metrics-log.csv` (header below) after each stage; export or screenshot the charts to `dashboard/<stage>-*.png` (crop out keys, project secrets and personal data).

CSV header: `utc,stage,minute,cpu_pct,mem_pct,swap_growing,io_budget_pct,iops,db_connections,connections_pct,api_5xx_60s,pgrst003_40001_57014,rpc_apply_mutation_ms,rpc_snapshot_ms,auth_429,realtime_conns,realtime_errors,vercel_5xx_timeouts,initials`

**Reference thresholds** (GO / STOP): CPU average < 70 % with no 5-minute window > 85 % / STOP > 90 % for 2 consecutive minutes. Connections peak < 75 % of limit / STOP > 85 %, any `PGRST003`. Memory and IO no sustained growth, swap or depleted budget / STOP memory > 90 % or swap growing, IO budget depleted. 5xx, `PGRST003`, `40001`, `57014`: 0 unexplained / STOP `57014` twice, any `40001`, 5xx burst of 3 in 60 s. Auth 429 / `over_request_rate_limit`: 0 / STOP any. PostgREST latency per RPC (`apply_conference_mutation`, `conference_state_snapshot`, `executive_state_snapshot`): recorded; STOP rows 2 and 3. Realtime: recorded (the harness simulates delivery, so little traffic is expected). Small connection limit 90 is the plan's figure; replace with the dashboard value: `____`.

### 7.1 Baselines
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | pre-S0 | -10 |  |  |  |  |  |  |  |  |  |  |  |
|  | pre-S0 | -1 |  |  |  |  |  |  |  |  |  |  |  |
|  | pre-H3 | -10 |  |  |  |  |  |  |  |  |  |  |  |
|  | pre-H3 | -1 |  |  |  |  |  |  |  |  |  |  |  |

### 7.2 S0 (t0 + 0 to 7, then settle)
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | S0 | 0 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 1 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 2 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 3 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 4 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 5 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 6 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | 7 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | settle +2 |  |  |  |  |  |  |  |  |  |  |  |
|  | S0 | settle +5 |  |  |  |  |  |  |  |  |  |  |  |

### 7.2 R1 (t0 + 0 to 7, then settle)
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | R1 | 0 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 1 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 2 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 3 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 4 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 5 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 6 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | 7 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | settle +2 |  |  |  |  |  |  |  |  |  |  |  |
|  | R1 | settle +5 |  |  |  |  |  |  |  |  |  |  |  |

### 7.2 R2 (t0 + 0 to 7, then settle)
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | R2 | 0 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 1 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 2 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 3 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 4 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 5 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 6 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | 7 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | settle +2 |  |  |  |  |  |  |  |  |  |  |  |
|  | R2 | settle +5 |  |  |  |  |  |  |  |  |  |  |  |

### 7.2 R3 (t0 + 0 to 7, then settle)
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | R3 | 0 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 1 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 2 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 3 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 4 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 5 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 6 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | 7 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | settle +2 |  |  |  |  |  |  |  |  |  |  |  |
|  | R3 | settle +5 |  |  |  |  |  |  |  |  |  |  |  |

### 7.3 H3 (t0 + 0 to 34, one row per minute)
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | H3 | 0 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 1 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 2 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 3 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 4 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 5 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 6 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 7 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 8 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 9 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 10 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 11 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 12 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 13 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 14 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 15 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 16 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 17 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 18 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 19 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 20 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 21 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 22 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 23 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 24 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 25 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 26 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 27 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 28 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 29 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 30 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 31 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 32 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 33 |  |  |  |  |  |  |  |  |  |  |  |
|  | H3 | 34 |  |  |  |  |  |  |  |  |  |  |  |

### 7.4 H5 recovery (10 minutes after the run ends)
| UTC | Stage | +min | CPU % | Mem % / swap | IO budget % / IOPS | DB conns (n, %) | API 5xx (60 s) | PGRST003 / 40001 / 57014 | RPC ms: apply / snapshot | Auth 429 | Realtime conns / errors | Vercel 5xx / timeouts | Init. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | H5 | 0 |  |  |  |  |  |  |  |  |  |  |  |
|  | H5 | 2 |  |  |  |  |  |  |  |  |  |  |  |
|  | H5 | 4 |  |  |  |  |  |  |  |  |  |  |  |
|  | H5 | 6 |  |  |  |  |  |  |  |  |  |  |  |
|  | H5 | 8 |  |  |  |  |  |  |  |  |  |  |  |
|  | H5 | 10 |  |  |  |  |  |  |  |  |  |  |  |

## 8. Incident log

Anything unexpected, STOP or not: log, alert, refusal, exit code, deviation from the card, a person's instruction. No secrets, no raw tokens or codes, no personal data (use the evidence rule in section 10). Copy to `incidents/incident-log.md`.

| # | UTC | Stage | What was seen (source: log, chart, runner) | STOP row? | Action taken / by | Resolved at (UTC) | Owner told? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |

## 9. Cleanup

Two different things, never mixed [packet 10]. **(a) Per-fixture revoke-only cleanup** touches only the database for that fixture and nothing else. **(b) Final retirement** waits until every approved run (including a 1 November contingency rerun, if the owner approves one) has finished and the evidence is saved. Run (a) for B at once after any STOP.

### 9.1 (a) Per-fixture revoke-only verification (one table per fixture: A and B)

Use the Supabase SQL editor with the reviewed `cleanup.sql`. Fixture A: after R3 per the packet, or after H3 (D2, preferred if B was prepared early). Fixture B: after H3 and the H5 observation, or at once after a STOP. Copy the query outputs (counts only) to `cleanup/fixture-A-revoke-verify.txt` and `cleanup/fixture-B-revoke-verify.txt`.

**Fixture A** conference UUID: `__________________________________`

| Step | How | Expected | Result | UTC / initials |
| --- | --- | --- | --- | --- |
| 1. Harness for this fixture finished or stopped | `pgrep -f rehearsal-run` prints nothing | no process |  |  |
| 2. Approver applies the reviewed `$A/cleanup.sql` | SQL editor; the file revokes only rows with this conference id and deletes nothing | succeeds (transaction commits) |  |  |
| 3. The file's own verify query | `select count(*) from public.user_access where conference_id='<UUID>' and revoked_at is null;` | 0 |  |  |
| 4. **Extra count (proposed, D4):** submission links | `select count(*) from public.submission_links where conference_id='<UUID>' and revoked_at is null;` | 0 (for B this is the QR bearer link) |  |  |
| 5. **Extra count:** amendment links | `select count(*) from public.amendment_links where conference_id='<UUID>' and revoked_at is null;` | 0 |  |  |
| 6. **Extra count:** access credentials | `select count(*) from private.access_credentials where conference_id='<UUID>' and revoked_at is null;` | 0 |  |  |
| 7. Original-conference fingerprint (PF15 query) | SQL editor | identical to `fingerprint-before.txt` |  |  |
| 8. Advisors (performance and security) | dashboard | no new findings against PF15 |  |  |
| 9. Keep, do not delete | `$A` folder, the pool (`.test-sessions/rehearsal/*.json`, `rehearsal-multi-identities.json`), `development.json` | still present |  |  |
| 10. Reports copied without samples | `jq 'del(.samples)'` per stage into the evidence folder; originals kept private | done |  |  |

**Fixture B** conference UUID: `__________________________________`

| Step | How | Expected | Result | UTC / initials |
| --- | --- | --- | --- | --- |
| 1. Harness for this fixture finished or stopped | `pgrep -f rehearsal-run` prints nothing | no process |  |  |
| 2. Approver applies the reviewed `$B/cleanup.sql` | SQL editor; the file revokes only rows with this conference id and deletes nothing | succeeds (transaction commits) |  |  |
| 3. The file's own verify query | `select count(*) from public.user_access where conference_id='<UUID>' and revoked_at is null;` | 0 |  |  |
| 4. **Extra count (proposed, D4):** submission links | `select count(*) from public.submission_links where conference_id='<UUID>' and revoked_at is null;` | 0 (for B this is the QR bearer link) |  |  |
| 5. **Extra count:** amendment links | `select count(*) from public.amendment_links where conference_id='<UUID>' and revoked_at is null;` | 0 |  |  |
| 6. **Extra count:** access credentials | `select count(*) from private.access_credentials where conference_id='<UUID>' and revoked_at is null;` | 0 |  |  |
| 7. Original-conference fingerprint (PF15 query) | SQL editor | identical to `fingerprint-before.txt` |  |  |
| 8. Advisors (performance and security) | dashboard | no new findings against PF15 |  |  |
| 9. Keep, do not delete | `$B` folder, the pool (`.test-sessions/rehearsal/*.json`, `rehearsal-multi-identities.json`), `development.json` | still present |  |  |
| 10. Reports copied without samples | `jq 'del(.samples)'` per stage into the evidence folder; originals kept private | done |  |  |

Not covered by `cleanup.sql`: the Auth sessions of the 22 pool identities stay valid until final retirement (they have no active grants after (a)). Record that here: `____`

### 9.2 (b) Final retirement: the list that MUST WAIT

Do **not** do any of these on 31 October unless the owner has declared every approved run finished, in writing, and the evidence is saved and checked. They remain human cutover steps [card; LIFECYCLE_CONTROLS.md; packet 10, 14].

| Item | Why it waits | Owner approval ref / done (UTC) |
| --- | --- | --- |
| Delete `.test-sessions/fixtures/*`, the 22 pool session files, `rehearsal-multi-identities.json`, `development.json` | Needed for any approved contingency rerun and for evidence |  |
| Delete original harness reports `.test-sessions/rehearsal-*.json` (after the sample-free copies are saved) | Samples are the only per-request record |  |
| Unset `SUBMIT_TOKEN` and `VERCEL_AUTOMATION_BYPASS_SECRET` in shells | Keep set while another run is approved |  |
| Delete the Preview deployment(s) used; retire connected Previews, server key and connectors | Owner approves; lifecycle cutover step 1 |  |
| Guarded deletion of labelled `LOAD TEST ·` conferences, Storage objects and test Auth users (scripts/cleanup, docs/SYNTHETIC_CLEANUP.md) | Prepared but not reviewed or approved; runs after the last synthetic test and before promotion |  |
| Revoke Auth sessions and refresh capability; record last possible token issuance; retire legacy API/server keys, Storage capabilities and cloud connectors | Lifecycle step 2; replace the preproduction server key with a fresh Production-only key |  |
| Token wait-out: 3,600 s from the last possible test-token issuance plus the recorded margin and any older longer-lived token | Lifecycle step 3 |  |
| Backup/restore evidence; acceptable data-loss window decision (PITR off is a state, not an approval) | Lifecycle step 3; before real data |  |
| Registry/marker transition to production; exact-SHA release approval; Production deployment; view-only verification; release sign-off; first production Executive bootstrap | Lifecycle steps 4 and 5; John Paul Ribeiru approves releases; cloud agents lose hosted access at promotion |  |
| No version, tag or Production configuration change belongs to this run | Card |  |

## 10. Evidence

**Rule: NO secrets, access codes, tokens, keys, identity files or session files are ever stored in the evidence folder.** That includes `.env.local`, `SUPABASE_SECRET_KEY`, any `sb_secret_` or `sb_publishable_` value, JWT-like strings, refresh/access tokens, `VERCEL_AUTOMATION_BYPASS_SECRET`, the submission token or any `/submit/<token>` link, staff access codes (six groups of four hex characters), `development.json`, `identities.json`, `rehearsal-multi-identities.json`, the pool session files, and the runner report **with** its `samples`. Write commands with `$PLACEHOLDER` names. Screenshots must be cropped to the chart or setting. UUIDs, commit SHAs, the project ref and counts are fine.

The folder `evidence/` is git-ignored by default (this change adds `/evidence/` to `.gitignore`; the older tracked `docs/evidence/` holds only reviewed, sanitized JSON). Nothing is committed from it without a person reading it.

Layout (`evidence/load-2026-10-31/`). The checker marks the "required" files:

| Path | Must contain | Required |
| --- | --- | --- |
| `SUMMARY.md` | go/no-go table (stage, label, GO/NO-GO, UTC, who), gate verdict and whether H3 counts toward the gate (with the owner decision ref), stops, deviations, links to the review items, reviewer sign-off | yes |
| `preflight/preflight-record.md` | Section 4 results: SHAs, deployment id, who approved, compute/backup/PITR/Auth-limit values, counts of identities created, fixture UUIDs (A, B), "set"/"unset" for secrets (never values) | yes |
| `preflight/target-guard.json` | The PF4 output line | yes |
| `preflight/migrations.txt` | The PF3b migration list from the staging project (versions and names) | yes |
| `preflight/fingerprint-before.txt` | PF15 query output, unchanged | yes |
| `preflight/payload-snapshots.json`, `preflight/plan-h3.json` | PF17 and PF19 outputs | no |
| `preflight/compute-pitr.png` and other screenshots | Cropped dashboard states | no (checker cannot scan images: look at each) |
| `stage-<ID>/command.txt` (ID = S0, R1, R2, R3, H3) | The exact command with `$SUBMIT_TOKEN` as written | yes (5) |
| `stage-<ID>/report.json` | Runner report with the `samples` array removed | yes (5) |
| `stage-<ID>/go-no-go.md` | Section 5 checkpoint table for that stage, timers, GO/NO-GO, who | yes (5) |
| `stage-<ID>/fingerprint-after.txt` | PF15 query output after the stage | yes (5) |
| `dashboard/metrics-log.csv` | Section 7 rows with the stated header | yes |
| `dashboard/<stage>-*.png` | Cropped charts: CPU, memory, IO, connections, API 5xx, PostgREST latency, Auth, Realtime, Vercel | no |
| `incidents/incident-log.md` | Section 8 (write "none" if none) | yes |
| `cleanup/fixture-A-revoke-verify.txt`, `cleanup/fixture-B-revoke-verify.txt` | Section 9.1 counts and fingerprint result | yes |
| `cleanup/retirement-pending.md` | The section 9.2 list marked "NOT DONE, waits for owner" | yes |

Check as you go and at the end (it reads only the named folder, prints file, line and rule but never the matched text, and needs no network):

```bash
npm run check:load-evidence -- evidence/load-2026-10-31 --allow-incomplete   # during the run
npm run check:load-evidence -- evidence/load-2026-10-31                      # at the end: exit 0 required
```

It reports FORBIDDEN (JWT-like strings, `sb_secret_`/`sb_publishable_` values, secret variables assigned a value, access-code shapes, submission links, token fields, bearer values, bypass headers, database URLs with passwords, forbidden file names, symlinks, a report that still has `samples`), MISSING required files, and images to review by eye. It is a safety net, not proof of absence: a human still reads every file before it leaves the machine.

Copy the stage summaries into [VERIFICATION.md](VERIFICATION.md) stating each report's label and whether it counts toward the gate (only a qualifying H3 can).

## 11. Sign-off

| Role | Name | Signature / initials | UTC |
| --- | --- | --- | --- |
| Harness operator |  |  |  |
| Dashboard watcher |  |  |  |
| Go/no-go decider |  |  |  |
| Independent reviewer (reviewed the report and every stop/go) |  |  |  |
| Approver (Zuhayr Siddique) |  |  |  |

