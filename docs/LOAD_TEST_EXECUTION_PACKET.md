# Load-test execution packet (operator copy)

Written 21 October 2026 on `origin/main` `276074a`. **PREPARED, NOT EXECUTED. Nothing in this packet is approved.** No hosted Supabase or Vercel call, load run, fixture, identity, credential, version change or tag was made to write it. It authorises no spending (including the Small upgrade) and no run. The owner (Zuhayr Siddique) must approve scope, timing and each hosted action in writing ([LOAD_TEST_PLAN.md](LOAD_TEST_PLAN.md) "Owner approval required before any hosted run"); John Paul Ribeiru approves releases; Zuhayr Siddique is in charge during any live problem.

This packet turns the merged plan ([LOAD_TEST_PLAN.md](LOAD_TEST_PLAN.md), approved as tooling and plan only, not as permission to run) into a sequence an operator can follow. It adds no behaviour. Every command and flag below was checked against the scripts on this commit ([Appendix A](#appendix-a-command-and-flag-cross-check)); where the packet disagrees with the plan, the script wins and the difference is called out.

Related: [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md), [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md), [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md), [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md), [STAFF_REHEARSAL.md](STAFF_REHEARSAL.md), [OFFLINE_REHEARSAL_AUTOMATED.md](OFFLINE_REHEARSAL_AUTOMATED.md), [VERIFICATION.md](VERIFICATION.md).

**Status markers used on every statement of substance:** **Verified** = read in the repository or computed by running local, no-network code on 21 October 2026 (re-do it if the commit changes). **Proposed** = a recommendation for the owner to accept, change or reject. **Untested** = depends on hosted behaviour, a dashboard value, a person or a script path nobody has run; do not rely on it.

## 0. Read this first

1. **The final capacity run must exercise the write path that actually ships.** [Verified] today every browser and every harness device writes directly to PostgREST (`SupabaseTransport.send` calls `rpc('apply_conference_mutation' ...)`, [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) F3). [Proposed, not built] the lifecycle's gate 6 requires a production-only write gateway, which adds one server hop per write ([ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) 6.6, test T20). Which path ships is an **owner decision not yet made** (nothing is approved):
   * **If the gateway ships:** only an H3 run through the gateway-capable build counts as the gate; a direct-path run is then development evidence.
   * **If the owner records an explicit, approved scope change that keeps the existing direct RPC architecture for this conference (deferring the gateway and attestation system):** the direct-path H3 **can** count as the capacity gate, because it is the path that ships. That scope change does **not** satisfy the lifecycle's original production-only write-gateway requirement; it must say so in writing, and the other lifecycle gates are unaffected.
   * A direct-path run is development-only **only** when the shipped path is not the direct path. Section 11 states the effect on the schedule.
2. **The runner has no auto-abort, no go/no-go between stages and no settle** ([Verified], `scripts/rehearsal-run.mts`, plan section 4). Every stop is a person's decision (section 7). One invocation is one stage; never use `--stages`.
3. **Delegate count 420 is an ASSUMPTION** ([Verified] not recorded in the repository). Section 12.
4. **Micro results are development evidence, not capacity acceptance** ([Verified], lifecycle "Pre-cutover evidence"; checklist 1.8.1 says do not run the load phases on Micro).
5. The plan's tooling status is current: fixture-conference guard, revoke-only `cleanup.sql`, and the no-network guard test exist ([Verified]: `scripts/rehearsal/guard.ts` `checkFixtureConference`, `cleanupSql` in `scripts/rehearsal/fixture.ts`, `tests/load-guard-no-network.test.ts`).

## 1. Who does what

[Proposed] (the plan's decision 5 is still open; the owner names the people).

| Role | Proposed holder | Does |
| --- | --- | --- |
| Approver | Zuhayr Siddique | Written approval of the exact commands in this packet; the stop authority; applies or approves every hosted SQL; Supabase upgrade and cost |
| Harness operator | Claude (cloud container) or the technical contact on a laptop | Runs `npm run rehearsal:*` and `npx tsx scripts/rehearsal-*.mts`; holds `.test-sessions/`; fills the run sheet |
| Dashboard watcher | Technical contact (Supabase and Vercel access) | Reads Supabase Observability, API/Postgres/Auth/Realtime logs and Vercel logs live; calls **STOP** |
| Go/no-go decider and settle timer | Named by the owner (not the harness operator alone) | Writes go/no-go in the run sheet after each stage |
| Independent reviewer | Codex | Reviews the run report and every stop/go decision (plan decision 10) |
| Release approver | John Paul Ribeiru | Not involved in running; approves only the release |

One operator holds the session files at a time (refresh tokens rotate; [Verified] plan section 3).

## 2. Pre-flight checklist (complete and record BEFORE fixtures or stage S0)

All items are operator checks recorded in the run sheet (section 9). Items marked **local** contact no network.

| # | Check | How | Pass | Status |
| --- | --- | --- | --- | --- |
| P1 | Written owner approval of the exact workload, window (UTC and Qatar time) and the people | [LOAD_TEST_PLAN.md](LOAD_TEST_PLAN.md) decisions 1-11, recorded in [VERIFICATION.md](VERIFICATION.md) | Exists and names this packet's commit SHA | Proposed |
| P2 | Real conference data does not exist in the project and no real Executive has been bootstrapped | Owner statement; [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) not yet run for real data | Confirmed in writing | Untested |
| P3 | **Target guard output (local, no network):** the ref is allow-listed and not production | `NEXT_PUBLIC_SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env.local \| cut -d= -f2-) STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado npx tsx -e "import {checkToolTarget} from './lib/platform/target-guard'; console.log(JSON.stringify(checkToolTarget(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env)))"` | `{"ok":true,"ref":"kllhswucdhqqywnzxado"}`. With `EXPECTED_SUPABASE_REF` also set to that ref it must refuse ("a project has exactly one role") | Verified (run locally with a stand-in URL, both outcomes seen); the run against the real `.env.local` is Untested |
| P4 | Operator shell: `EXPECTED_SUPABASE_REF` unset; the ref `kllhswucdhqqywnzxado` is listed in **exactly one** of `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS` (the guard accepts either; which one is an operational choice; both is refused) | `printenv EXPECTED_SUPABASE_REF` prints nothing; read the two lists | As stated. Shell variables override `.env.local` (the tools merge `{...env, ...process.env}`), so check the shell, not only the file | Verified (code); values Untested |
| P5 | **`NEXT_PUBLIC_CONFERENCE_ID`** is set (shell or `.env.local`) to the original conference `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`. **`PROTECTED_CONFERENCE_IDS`** is a comma list holding the 21 Oct temporary conference id (not recorded in the repository: the owner supplies it) and any other conference to protect | Read the values; each must be a UUID | Missing, blank or malformed means the tools refuse (fail-closed) | Verified (guard code and `tests/load-guard-no-network.test.ts`); ids Untested |
| P6 | **Fixture conference isolation:** each fixture's `fixture.json` `conference` differs from both protected ids | Compare by eye and rely on the guard; the guard runs before any request in `load-test.mts`, `rehearsal-run.mts` and `rehearsal-snapshots.mts` | Different UUIDs | Verified (guard); per-fixture check Untested |
| P7 | `supabase/fixture-ids.json` exists and `.test-sessions/development.json` exists (every hosted script imports `scripts/remote-context.mts`, which reads both). Create the session file with `npx tsx scripts/prepare-session.mts` (one anonymous sign-in; counts against the hourly limit) | `ls supabase/fixture-ids.json .test-sessions/development.json` | Both present. **The plan's step list does not mention `prepare-session`; the scripts need it** | Verified (code: `remote-context.mts`, `prepare-session.mts`); run Untested |
| P8 | **Small compute confirmed in the dashboard** (Organisation, Billing: plan Pro; Project, Settings, Compute and Disk: size Small, disk size) with a dated screenshot. If it still says Micro, only L0 and S0 may run, and only with approval; the final gate may not | Dashboard (the connector cannot read it: checklist 1.2) | "Small" visible; recorded | Untested |
| P9 | **PITR and backups:** scheduled daily backup exists and the last one succeeded; PITR state (on/off, retention) recorded. Decide **before real data**, not for the load run, but record the state so a restore is possible if a fixture step misbehaves | Dashboard, Database, Backups | State recorded; owner decision noted (checklist 1.2.4-1.2.6) | Untested |
| P10 | Supabase Auth anonymous sign-in rate limit value (default 30 per IP per hour; confirm), and the network the run is made from | Dashboard, Authentication, Rate limits | Value recorded | Untested |
| P11 | Preview deployment of a **named commit**, `/api/health` shows `environment` of `preview`, and (for the public-form part) its `SUPABASE_SECRET_KEY` points at this project. **Which build it is matters:** see section 11 | Vercel dashboard; open `<preview>/api/health` in a browser | Commit SHA recorded; environment not `production` | Untested |
| P12 | If the Preview is protected, `VERCEL_AUTOMATION_BYPASS_SECRET` is set **in the operator's shell only** (the runner reads it from the environment and sends it as `x-vercel-protection-bypass`) | `printenv` not required; never print or write it | Set in shell, in no file | Verified (code) |
| P13 | Baseline fingerprint of the original conference (the SQL in [LOAD_TEST_PLAN.md](LOAD_TEST_PLAN.md) "Isolation checks the operator performs", read-only, SQL editor) and Advisors (performance and security) recorded | SQL editor by the technical contact | Saved in the evidence folder | Proposed |
| P14 | Dashboards open before S0: Supabase Observability (CPU, memory, disk IO, database connections), API logs, Postgres logs, Auth logs, Realtime logs; Vercel project Logs and Functions | Two windows, time range "last 30 minutes", auto-refresh | The watcher confirms | Proposed |
| P15 | Stop authority and communication channel named; on-call contact for the owner | Run sheet | Named | Proposed |
| P16 | Local readiness: `npm run typecheck`, `npm run lint`, `npm test` pass on the commit under test, and the plan arithmetic is reproduced (section 6) | Local (L1, L2 in the plan) | Green; numbers match | Plan numbers Verified on this commit (section 6) |
| P17 | The **write path under test is identified** (direct or gateway-capable) and written in the run sheet | Section 11 | Stated | Proposed |

## 3. Fixtures and identities

Two fixtures, one shared identity pool. All commands run from the repository root on the operator machine. Session files stay under the git-ignored `.test-sessions/` (mode 0600) and are never printed, copied or committed ([Verified], `.gitignore`, scripts).

### 3.1 Identity pool (the day before; Harness operator; Approver approves)

```bash
npm run rehearsal:identities -- --chairs 19
```

[Verified] flags `--chairs`, `--pace-seconds` (default 20 s), `--dir`, `--out` (default `.test-sessions/rehearsal-multi-identities.json`). It creates one anonymous session per Chair (19) plus Approval, Admins, Executive = **22** identities, paced, capped at 25 new sign-ins per run, so about 8 minutes. `prepare-session` adds one more sign-in, so 23 in total, still below the default 30 per IP per hour ([Untested] against this project's configured limit, P10). It refuses a project not in the allow-list before any connection. The same 22 identities serve both fixtures.

### 3.2 Fixture A: stages S0, R1, R2, R3 (Harness operator generates; Approver or technical contact applies SQL)

```bash
npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 19 --delegates 420 --grant-hours 3
```

[Verified] flags `--identities` (required), `--committees` (default 14, max 40), `--delegates` (default 420, max 2000), `--grant-hours` (default 3, max 12). It touches **no network and no database**; it writes `.test-sessions/fixtures/<conference>/{fixture.json, identities.json, fixture.sql, cleanup.sql}` and prints the new conference UUID. `--delegates 420` is the assumed roster (section 12).

Steps:

1. Operator reads `fixture.sql` and `cleanup.sql`: one conference id throughout, 19 committees, 19 Chair grants plus 3 role grants (22), no Auth or secret content ([Proposed] review, mirrors plan L3).
2. Check P6 (conference id differs from the protected ids).
3. **Approver applies `fixture.sql`** in the Supabase SQL editor (or approves a scoped connector run; the lifecycle allows "reviewed scoped cloud-agent test access" in this phase, the scope is not recorded: [Untested]). Grants expire in 3 hours by design. **This is a hosted write and needs the written approval of P1.**
4. Payload check: `npx tsx scripts/rehearsal-snapshots.mts --identities .test-sessions/fixtures/<A>/identities.json --fixture .test-sessions/fixtures/<A>/fixture.json --all-chairs` ([Verified] flags `--identities`, `--fixture`, `--reads`, `--worst-case`, `--components`, `--all-chairs`; read-only). Record bytes and p50/p95 per role; the 19-committee sizes are not yet measured ([Verified] the plan says re-measure).
5. Re-run the P13 fingerprint; it must equal the baseline.

Fixture A is **reused** across S0-R3 ([Verified] plan): accumulated history makes later stage latencies informational, not gate evidence.

### 3.3 Fixture B: the final H3 gate (fresh)

Create it only when H3 is about to run (grants must not be mid-expiry), on the same pool:

```bash
npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 19 --delegates 420 --grant-hours 4
```

`--grant-hours 4` so H3 (30 min plus drain), H4 and H5 fit inside one grant lifetime ([Proposed], plan section 4). Then:

1. Apply `fixture.sql` (Approver, as for A). Re-check P6 and the P13 fingerprint.
2. **Create one resolution submission link** for the committee you will pass as `--submit-committee` (default is the first fixture committee code, `GA1`; the plan names `GA1` as the example). The plan says to create it on the Preview as the fixture Executive identity (Executive, Submission links). **How an operator signs the fixture's anonymous Executive identity into a browser is not documented in the repository** ([Untested]): decide the method (for example a reviewed one-off access-code bootstrap on the temporary conference, [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md)) and rehearse it on Micro before 31 October. Without a link, delegates request a deliberately invalid link and the run is not the gate H3.
3. Note the token **in the shell only** (for example `export SUBMIT_TOKEN=...`); do not write it into the run sheet, a file or chat.

## 4. Stages S0, R1, R2, R3 (one invocation each, single stage)

Define once per shell (placeholders; no secrets):

```bash
export PREVIEW="https://<the-preview-url>.vercel.app"        # a Preview deployment or branch URL; never a custom domain or alias
export A=".test-sessions/fixtures/<conference-A-uuid>"
export B=".test-sessions/fixtures/<conference-B-uuid>"
```

`rehearsal-run.mts` refuses any URL that is not localhost or a `*.vercel.app` Preview/branch URL, refuses a target whose `/api/health` says `production`, and has no default target ([Verified], `scripts/rehearsal/guard.ts`). Realtime `topic-aware` and Executive Chair window 2000 ms are the defaults ([Verified]).

| Stage | Command (from the repository root) | Duration | What the printed report will say ([Verified] from `readiness.ts` and `guard.ts`) |
| --- | --- | --- | --- |
| **S0** (10 staff) | `npm run rehearsal:run -- --app $PREVIEW --identities $A/identities.json --fixture $A/fixture.json --staff 10 --minutes 5` | 5 min + drain up to 120 s | `NOT A READINESS RUN` (Chair traffic in 7 of 19 committees); capacity text "BELOW the 50-staff comparison (smoke / warm-up only)". Cannot PASS |
| **R1** (25) | same with `--staff 25 --minutes 5` | 5 + drain | `NOT A READINESS RUN` (16 of 19 committees); "BELOW the 50-staff comparison" |
| **R2** (50) | same with `--staff 50 --minutes 5` | 5 + drain | `READINESS RUN` structurally (19 committees); "BELOW the current 110-device gate"; does not count toward the gate |
| **R3** (80) | same with `--staff 80 --minutes 5` | 5 + drain | As R2 |

Planned load per stage ([Verified] by `npm run rehearsal:plan` on this commit, 19 committees, 5 min, no delegates): S0 106 staff writes, R1 252, R2 463, R3 702. Roles: 7/1/1/1, 16/3/3/3, 35/5/5/5, 56/8/8/8 (Chair/Approval/Admins/Executive). Snapshot RPC counts (about 199, 609, 1,574, 3,325 at a 600 ms refresh) are the plan's estimates: [Verified] arithmetic in the plan, [Untested] against the hosted system; the live runner prints the real count.

### 4.1 Go/no-go checkpoint (after EVERY stage, before the next)

The decider writes **GO** or **NO-GO** with the UTC time in the run sheet. Go only if every row is clean. A NO-GO ends the ramp; never skip to a larger stage and never start the next stage on the same fixture after a stop condition (section 7).

| # | Checkpoint | Who | Threshold for GO | Source |
| --- | --- | --- | --- | --- |
| C1 | Runner: no duplicate writes, no lost acknowledged writes | Runner | 0 and 0 | Runner verdict |
| C2 | Runner: error rate (samples with outcome error; conflicts and rate-limited excluded) | Runner | < 1 % | Runner verdict |
| C3 | Runner: rate-limited (429) responses | Runner | 0 | Runner verdict |
| C4 | Runner: worst per-action write p95 | Runner | <= 1,500 ms | Runner verdict |
| C5 | Runner: worst per-action read p95 | Runner | <= 2,500 ms | Runner verdict |
| C6 | Runner: outbox drained (`pendingAtClose` 0, drain seconds printed) | Runner, read by operator | 0 pending | Report JSON |
| C7 | Operator: 5xx, `PGRST003`, `40001`, `57014` in the run window | Watcher | 0 unexplained | Supabase API and Postgres logs |
| C8 | Operator: Postgres CPU | Watcher | average < 70 %, no 5-minute window > 85 % | Observability |
| C9 | Operator: connections | Watcher | peak < 75 % of the plan limit (Small: 90 direct, per the plan's cited public docs, re-check) | Observability |
| C10 | Operator: memory and disk IO | Watcher | no sustained growth or swap; IO budget not depleted | Observability |
| C11 | Operator: original-conference fingerprint (P13 query) | Technical contact | identical to baseline | SQL editor |
| C12 | Vercel: 5xx or timeouts on `/api/*`, `/api/health` | Watcher | 0 | Vercel Logs |
| C13 | **Settle two minutes (manual, timed by the decider):** connections idle, CPU and IO near baseline, no `PGRST003` or `40001` | Decider | back to baseline within 2 min; if not, one further 3 min, else **stop** | Observability, logs |

Only the six runner checks (C1-C5 plus the distribution label) are enforced by code and only **once, at the end** ([Verified]); everything else is a person's reading. The readiness label of S0-R3 is not part of go/no-go. Planned time for S0-R3 with reviews and settles is about 50 minutes ([Proposed], plan).

## 5. Stage H3: the final gate (110 staff, 19 committees, 30 minutes)

Fixture B, fresh. **Counts as the gate only if all of these hold:** report says `READINESS RUN`; capacity text says "CURRENT capacity gate size (110 devices ...)"; the run went through the write path intended for release (section 11); and the operator thresholds in section 5.2 are met. [Verified] label logic in `capacityGateLabel` (110 or more is the gate size) and `readinessVerdict`.

```bash
npm run rehearsal:run -- --app $PREVIEW --identities $B/identities.json --fixture $B/fixture.json \
  --staff 110 --minutes 30 --delegates 150 --delegate-window 120 \
  --submit-token "$SUBMIT_TOKEN" --submit-committee GA1 --submit-fraction 0.08
```

### 5.1 What actually executes ([Verified] by `npm run rehearsal:plan` and `buildScenario` run locally on this commit)

* 110 staff: 77 Chair, 11 Approval, 11 Admins, 11 Executive, across 19 committees; **3,841 staff writes (128 per minute)**. Snapshot RPCs about 27,200 (about 907 per minute, 15 per second) at an assumed 600 ms refresh: estimate, [Untested] on hosted.
* **Public form: 150 page loads, uniformly inside the first 120 s of the run** (last load at 119.8 s in the seeded scenario), plus **16 resolution submissions** at `--submit-fraction 0.08`, each 30-180 s after its own page load, i.e. **between 57 s and 282 s into the run** (computed 57.3 s to 282.5 s). All 16 land inside one 10-minute window on one link (designed limit 20 per 10 minutes; the runner refuses a plan above 18).
* **Public traffic starts with the run, not later**, so it overlaps the staff start burst (all 110 devices open within a 150 s start window). A delayed burst is not available without new reviewed tooling ([Verified], plan).
* Before any request the runner prints `Stage 110 staff: 150 public page loads, 16 resolution submissions planned on one link (max 18).` **The operator confirms the printed submission count is exactly 16 and stops if it differs** (the count depends on seed, minutes, delegates, fraction, staff and committee count). At the default fraction 0.10 it would print 18; at 0.05, 10 ([Verified] in the plan; 0.08 reproduced here).
* Page loads and submissions create **no Supabase Auth session** for delegates ([Verified] code). The submission link must belong to the committee named by `--submit-committee`, created on the Preview ([Untested] procedure, section 3.3).
* The runner ends the stage at 30 minutes, drains up to 120 s until every outbox is empty, evaluates once, writes `.test-sessions/rehearsal-<UTC time>.json` (mode 0600, with samples) and exits 1 if the verdict fails.

### 5.2 H3 acceptance (all rows; "Runner" is enforced by code at the end, "Operator" is a human reading)

| Metric | PASS | Checked by |
| --- | --- | --- |
| Run label | `READINESS RUN` and "CURRENT capacity gate size (110 devices ...)" | Runner, read by operator |
| Duplicates and lost acknowledged writes | 0 and 0 | Runner |
| Error rate (all samples, conflicts and rate-limited excluded) | < 1 % | Runner |
| 429 responses | 0 | Runner |
| Write p95 | worst per-action <= 1,500 ms (aggregate also recorded) | Runner (worst per-action); operator (aggregate) |
| Read p95 | worst per-action <= 2,500 ms | Runner |
| p99 write and read | recorded; > 10 s needs a written explanation | Operator |
| Public page p95 | <= 2 s, no 5xx; all 16 submissions succeed; no Auth activity from delegates | Operator (the runner has no page-p95 check) |
| 5xx, `PGRST003`, `40001`, `57014` | 0 unexplained | Operator (5xx also raise the runner error rate) |
| PT409 conflicts | reported per 100 writes; each explainable; none lost | Operator |
| Postgres CPU | average < 70 %, no 5-minute window > 85 % | Operator |
| Connections | peak < 75 % of the plan limit; all idle after H5 | Operator |
| Memory, disk IO | no sustained growth or swap; IO budget not depleted | Operator |
| Recovery (H5, 10 minutes after stop) | outbox drained; connections idle within 5 minutes | Runner (drain), operator (connections) |
| Isolation | original-conference fingerprint identical; no write outside the fixture conference | Operator |

The H3 thresholds are [Proposed] starting points inherited from [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) and `evaluate()` in `scripts/rehearsal/metrics.ts`; adjust only with the owner and the independent reviewer.

H4 (vote-closing spike) and H5 (recovery observation) follow H3 only if approved; see section 13 (G1) for H4. H5 is a 10-minute dashboard observation with no command.

## 6. Reproduce the plan arithmetic locally before approval (no network)

```bash
npm run rehearsal:plan -- --staff 110 --delegates 150 --committees 19 --minutes 30 --read-ms 600,2500 --realtime topic-aware --submit-fraction 0.08
npm run rehearsal:plan -- --staff 25 --delegates 0 --committees 19 --minutes 5 --read-ms 600 --realtime topic-aware   # repeat with 10, 50, 80
```

[Verified] on this commit: H3 roles 77/11/11/11, 3,841 writes, 128 per minute, 150 page loads, 16 submissions; S0 106, R1 252, R2 463, R3 702 writes. If a later commit changes `scripts/rehearsal/scenario.ts`, redo this and re-confirm the printed 16.

## 7. Stop conditions (all manual; the runner has no auto-abort)

The Watcher calls **STOP**. The operator then presses Ctrl-C in the harness (this discards in-memory outboxes; acceptable, the data is synthetic) and applies `cleanup.sql` (section 10). The thresholds are those of the plan's section 7 ([Proposed], awaiting approval), repeated here so the packet stands alone.

| # | Stop on | Exact threshold |
| --- | --- | --- |
| 1 | Any write to a real or original conference | Fingerprint differs, or an API log shows a `conference_id` other than the fixture. Do not resume; notify the owner |
| 2 | Error rate (conflicts excluded) | > 2 % in any 60 s window, or > 1 % over 5 minutes |
| 3 | Latency | write p95 > 5 s or read p95 > 8 s for 3 consecutive minutes; any single request > 30 s |
| 4 | Postgres CPU | > 90 % for 2 consecutive minutes |
| 5 | Connections | any `PGRST003`; database connections > 85 % of the limit; pool fully busy > 60 s |
| 6 | Memory and IO | memory > 90 % or swap growing; IO budget depleted or IOPS pinned |
| 7 | Server errors | `57014` twice in a window; any `40001`; 5xx burst of 3 or more in 60 s |
| 8 | Auth rate limiting | any 429 or `over_request_rate_limit` from Auth (the pool is pre-created; do not retry) |
| 9 | PostgREST or public-form rate limiting | any 429 on staff routes; any 429 on the public form (the plan exceeded the per-link limit) |
| 10 | Wrong target | the guard or health check reports `production`, or the wrong ref appears anywhere |
| 11 | Real production surface | anything unexpected on the real Supabase or Vercel production surface (alerts, deployments) |
| 12 | Authority | the owner or the person in charge says stop |

After a stop: do not restart on the same fixture, do not continue the ramp; record time, cause and the last good metrics; the next attempt needs a new approval for the changed scope ([Verified] plan).

## 8. Metrics to capture

Record the exact run window in UTC (stage start printed by the runner, end from the report `date`). **Two different kinds of evidence; never mix them in the report.**

### 8.1 Runner-computed (client side; the file `.test-sessions/rehearsal-<time>.json`) [Verified]

Per action: requests, ok, conflicts (PT409 / 409), rate-limited, errors, p50/p95/p99; read and write percentiles per role; page-load timings and submission outcomes; triggers attempted and dropped; refreshes by source; snapshot RPCs sent (`snapshotRpcsByName`); drain seconds and `pendingAtClose`; exactly-once result (duplicates, lost); `READINESS RUN` label and Chair/committee coverage; capacity-gate text; the app build identity from `/api/health` and the Supabase project ref.

### 8.2 Operator-observed (server side; NOT computed by the runner) [Proposed]

| Signal | Where | Note |
| --- | --- | --- |
| Supabase CPU, memory, swap | Observability | Sustained use, not spikes |
| Database connections | Observability; `select state, count(*) from pg_stat_activity group by 1` (SQL editor) | Compare with the Small limit read from the dashboard |
| Disk IO bandwidth, IOPS, IO budget | Observability | Sustained H3 is the test of this |
| 5xx, `PGRST003`, `57014`, `40001`, 429 | API, Postgres and Auth logs | Count each separately |
| PostgREST latency per RPC | API logs for `/rest/v1/rpc/apply_conference_mutation`, `conference_state_snapshot`, `executive_state_snapshot` | `pg_stat_statements` gives mean/max per statement, not percentiles |
| Auth | Auth logs: anonymous sign-ins, refreshes, `over_request_rate_limit` | Expect near zero |
| Realtime | Realtime logs and Observability: connections, messages | The harness **simulates** Realtime notifications; real Realtime fan-out is not exercised (section 13, G5) |
| Vercel | Logs and Functions: 5xx and duration of `/api/*`, `/submit/*`, `/api/health`; function concurrency and timeouts | Region `bom1`; read the team's limits in the dashboard. Through a gateway build, the write route's own duration and concurrency are part of the gate |
| Advisors | `get_advisors` equivalent in the dashboard, before and after | No new findings |
| One real Chair browser kept open | System health page | Subjective responsiveness |

## 9. Evidence capture (no secrets)

Directory (outside the repository working tree, or inside the ignored `.test-sessions/` is also acceptable; never in a tracked path):

```text
load-evidence/<YYYY-MM-DD>-<run-id>/
  00-approval.md            who approved, when, scope, the packet commit SHA (no keys)
  01-preflight.md           P1-P17 results; dashboard screenshots for compute and PITR (crop out any key)
  02-fingerprint-before.txt / 02-fingerprint-after-<stage>.txt
  03-fixture-<A|B>.md       conference UUID, committee count, delegate count, grant-hours (no session files, no tokens)
  04-<stage>-report.json    the runner report with the `samples` array removed (jq 'del(.samples)'); keep the original private
  04-<stage>-sheet.md       the run sheet below
  05-supabase/<stage>/      screenshots or CSV exports: CPU, memory, IO, connections, API 5xx, PostgREST latency
  06-vercel/<stage>/        function errors and duration export, deployment URL and commit SHA
  07-cleanup.md             cleanup verification (section 10)
  08-summary.md             go/no-go table, gate verdict, stops, deviations, reviewer sign-off
```

Never put in the folder: session files (`.test-sessions/rehearsal/*.json`, `development.json`), access tokens, `SUPABASE_SECRET_KEY`, `VERCEL_AUTOMATION_BYPASS_SECRET`, the submission token, access codes, `.env.local`.

Run sheet template (one per stage):

```markdown
# <stage ID> run sheet
- Date / UTC start / UTC end:                    Qatar time:
- Commit SHA under test:        Preview URL (host only):        Deployment id:
- Write path: direct | gateway-capable (build id)      Shipped path (owner decision ref):      Counts toward the gate? yes | no (reason)
- Supabase compute / disk (from dashboard):      Plan:       PITR:
- Fixture conference id (A or B):      Protected ids differ? yes/no      NEXT_PUBLIC_CONFERENCE_ID set? yes
- Command line run (paste, with the token replaced by $SUBMIT_TOKEN):
- Printed submissions line (H3: must read 16):
- Runner verdict and label:      Capacity text:      Exit code:
- Runner checks C1-C6:   dup __  lost __  error % __  429 __  worst write p95 __  worst read p95 __  pendingAtClose __
- Operator checks C7-C12 and fingerprint:   (values)
- Stop condition triggered? (number, time, action)
- Settle result (2 min):      GO / NO-GO at <UTC>      by <name>
- Observations / deviations:
```

Copy the summary into [VERIFICATION.md](VERIFICATION.md) stating, for each report, its label and whether it counts toward the gate (only a qualifying H3 can).

## 10. Cleanup (revoke-only per fixture; final retirement once; guarded deletion later)

[Verified] `cleanup.sql` (generated per fixture by `rehearsal-fixture.mts`; the legacy `prepare-load.mts` writes `.test-sessions/load-cleanup.sql`) revokes, **only for the fixture conference id**, every `user_access` grant, `submission_links`, `amendment_links` and `private.access_credentials` (the SQL touches these tables; it makes no claim about what PostgREST exposes); it **deletes nothing** and ends with a verify query expected to return 0.

**Two different things, never mixed.** [Verified] fixtures A and B (and any rerun fixture) reuse the **same 22-identity pool** and the same `development.json`: fixture B is generated from the pool just before H3, after A has ended.

* **(a) Per-fixture revoke and isolation check** (happens after each fixture's last stage, and at once after any stop). It touches **only the database** for that fixture. It must **not** delete the identity pool, `development.json`, `rehearsal-multi-identities.json` or any other fixture's files.
* **(b) FINAL global retirement** (happens once, only after **every approved fixture and stage, including contingency reruns, has finished** and the evidence is saved).

### 10.1 Ordered timeline

| Order | When | Action | Who |
| --- | --- | --- | --- |
| 1 | After R3 (fixture A done) | (a) for A: apply `A/cleanup.sql`, run its verify query (0); P13 fingerprint equals baseline. **Keep** the pool, `development.json`, A's local files (needed for evidence and, if a rerun on A is approved, for it) | Approver or technical contact; Harness operator |
| 2 | Before H3 | Generate fixture B from the same pool (section 3.3); apply its SQL | Harness operator; Approver |
| 3 | After H3 (and H4/H5 if approved) | (a) for B: apply `B/cleanup.sql`, verify (0), fingerprint. Keep the pool and session files **if a contingency rerun is still approved** | As above |
| 4 | Each contingency rerun (for example 1 Nov) | New fixture from the same pool; at its end (a) for that fixture. Repeat until no further run is approved | As above |
| 5 | After the LAST approved run, evidence saved | (b) final retirement, checklist below | Harness operator; technical contact; owner approves Preview deletion |
| 6 | After the last synthetic test, before promotion | Guarded deletion of synthetic data (10.3) | Human operator after review |

### 10.2 What is deleted when

| Item | After each fixture (a) | FINAL (b) |
| --- | --- | --- |
| Fixture grants, submission and amendment links, access credentials (database, via that fixture's `cleanup.sql`) | **Revoke**, verify 0 | Confirm every fixture shows 0 |
| Original-conference fingerprint and Advisors check | Run | Run once more |
| `.test-sessions/fixtures/<that conference>/` local files | Keep (evidence; needed for reruns on it) | Delete all |
| `.test-sessions/rehearsal/*.json` (the 22 pool session files), `.test-sessions/rehearsal-multi-identities.json` | **Keep** | Delete |
| `.test-sessions/development.json` | **Keep** | Delete |
| Harness reports `.test-sessions/rehearsal-<time>.json` | Keep until copied (samples removed) to the evidence folder | Delete the originals after copying |
| `VERCEL_AUTOMATION_BYPASS_SECRET`, `SUBMIT_TOKEN` in shells | Keep set only while another run is approved | Unset |
| Preview deployment(s) used | Keep | Delete (lifecycle cutover step 5), owner approves |
| Anonymous test users in the dashboard | Keep | Optional now; otherwise cutover covers them |
| Labelled `LOAD TEST ·` conferences and auth users | Keep (labelled, no active access) | Keep until guarded deletion |

### 10.3 Guarded deletion and ordering

**Guarded deletion** of the labelled `LOAD TEST ·` conferences, Storage objects and test auth users (lifecycle cutover step 2; checklist 1.9.5 and 2.2) is reviewed by Codex, approved by the owner and run by a human operator **after the last synthetic test and before promotion**. It is **not implemented** ([Verified] checklist 1.9.5 is OUTSTANDING: "a reviewed, guarded cleanup script or procedure with a read-only before/after count"). No one deletes rows by hand during the test window.

**Ordering rule** ([Verified], lifecycle "Formal cutover" steps 2 and 6): revocation and guarded deletion of all synthetic data must complete **before** the project is promoted and before any real conference data exists. Revoke-only cleanup does not satisfy cutover step 2.

## 11. The final run must exercise the write path intended for release

[Verified] facts: all browser writes and all harness writes use `SupabaseTransport` straight to PostgREST today; the harness constructs `SupabaseTransport` directly (`scripts/rehearsal-run.mts`). [Verified] the design in [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) section 6 adds a gateway (one extra hop per mutation, T20 "capacity through the gateway at Small") and its rollout step 4 says the load and rehearsal harness "is moved onto the gateway with a `test` key, so rehearsals exercise the real path. Re-run capacity at Small through the gateway". Its step 5 then revokes direct execute on the gated functions, after which **pre-gateway builds and the current direct-path harness stop working**. None of this is built, approved or reviewed ([Verified] "design for review, not implemented").

Rules for the owner and the reviewer ([Proposed]; nothing here is approved):

1. **The gate run, the build released and the write path of the conference must be the same path.** A later change to the write path invalidates the gate and requires a rerun.
2. **If the gateway ships:** the gate is an H3 run against a Preview that is the gateway-capable build (preproduction runtime policy), with a harness that sends through the gateway. A direct-path H3 is then development evidence and the run sheet says "Counts toward the gate? no: shipped path is the gateway".
3. **If the owner approves, in writing, a scope change that retains the existing direct RPC architecture for this conference** (the gateway and attestation system deferred; [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) D1 option (b) or similar): a direct-path H3 **counts as the capacity gate**, and the run sheet says "Counts toward the gate? yes: direct path is the approved release path (scope change ref: ...)". This does **not** satisfy the lifecycle's original production-only write-gateway requirement; the scope change must record that, and the compensating controls, and the other lifecycle gates still apply.
4. **Until the owner chooses,** a direct-path H3 is recorded as "gate-eligible only if the direct path is approved as the release path". Do not label it development-only or gate-qualifying in advance.
5. Direct-path stages S0-R3 validate the guards, identities, fixtures, runner and the read path in either case. They do not validate the gateway's added latency, the Vercel function concurrency or cost of the write route, or the proof-minting cost; if the gateway ships, R2 and R3 should be repeated through it if time allows, otherwise H3 is the first time the gateway meets load.
6. **Effect on the schedule:**
   * *Direct path approved as release path:* no gateway dependency; the 31 October H3 can be the gate (subject to the other conflicts in the plan), 1 November is the rerun day.
   * *Gateway ships:* the earliest qualifying gate is the date the gateway, the harness change and the additive migration (rollout step 3) land after review, **plus** the time to deploy and verify the gateway-capable Preview. If that is after 31 October, the 31 October run is development evidence and the gate moves to 1 November, leaving cutover on 2 November with no slack. If it is after 1 November, the 2 November cutover cannot rest on a qualifying gate.
   * *Owner has not decided by the time the Preview is prepared:* the schedule cannot be confirmed, because which build to prepare depends on it.
   See [LOAD_TEST_PLAN.md](LOAD_TEST_PLAN.md) "Schedule targets and conflicts".

## 12. Delegate count: confirmed versus assumed

[Verified] the repository does not record the real delegate count. **420 is an ASSUMPTION** (about 22 per committee, the fixture default). Two different numbers must not be confused:

* The **fixture roster** (`rehearsal-fixture.mts --delegates N`): rows in the synthetic conference, spread round-robin over the 19 committees ([Verified] `fixture.ts`).
* The **simulated public visitors** (`rehearsal-run.mts --delegates 150`): page loads of the public form in the first 120 s, independent of the roster ([Verified] `buildScenario` takes no roster size). 150 is itself an assumption (150-200 loads per the plan).

| Assumed real delegations | Per committee (19) | Fixture command change | Effect on the **harness traffic** (writes, snapshot RPC counts, public loads, 16 submissions) | Effect on payload and DB size |
| --- | --- | --- | --- | --- |
| 380 | 20 each | `--delegates 380` | None (no roster parameter in the scenario) | Smaller Chair, Approval, Executive snapshots |
| **420 (assumed)** | 22 or 23 (17 committees with 22, 2 with 23) | `--delegates 420` | None | The plan's figures (Chair 11.9 KB, Executive 121 KB were measured on 14 committees / 420 delegates; 19 committees not yet measured) |
| 460 | 24 or 25 (15 with 24, 4 with 25) | `--delegates 460` | None | Larger snapshots |
| 570 (plan sensitivity) | 30 each | `--delegates 570` | None | Largest |

Per-committee counts are arithmetic ([Verified]: 380 = 19 x 20; 420 = 19 x 22 + 2; 460 = 19 x 24 + 4). The qualitative direction of payload change is [Untested]: re-measure with `rehearsal-snapshots.mts` on fixture A at the **owner-confirmed** count and use the confirmed number for fixture B. If the confirmed count differs from 420, record it, regenerate fixture B with the confirmed `--delegates`, and re-run the snapshot probe; the 16-submission count does not change. The **real** operational difference is on the conference side: roll call write volume (about 22 marks per Chair) is a harness constant, not scaled to the roster.

## 13. Gaps that need SEPARATE checks

The harness does not cover these. Each needs its own approval; none is part of the H3 verdict. Owners are [Proposed].

| # | Gap | Why the harness does not cover it | Owner | Method | Exit criteria |
| --- | --- | --- | --- | --- | --- |
| G1 | **Simultaneous voting (H4 vote-closing spike)**, W3 | The runner has no vote action ([Verified] plan decision 11). 19 Chairs closing one vote each in a 10 s window, 3 rounds, would send 19 `apply_conference_mutation` calls in about 10 s plus an Approval/Admins/Executive refresh wave | Approver names the people; Harness operator runs the 50-staff background (`--staff 50 --minutes 15`); the named people close votes in the app | **How voters get access is undecided**: no script grants staff access to the temporary conference. Options for the owner: a reviewed access-code bootstrap on fixture B, or add real-person grants by SQL using `fixture.sql` conventions. Run after H3 on fixture B within the 4-hour grants | 19 closures x 3 rounds accepted with no lost or duplicate ballot, no `40001`, no `PGRST003`, p95 write <= 1,500 ms and refresh wave within read thresholds. Otherwise W3 stays **unverified** and is recorded as such |
| G2 | **School-network / shared-NAT enrollment** (Phase D) | Pool identities are pre-created; no fresh sign-in burst is run (plan "Out of scope") | Technical contact with real devices or browser profiles on one network (ideally the school Wi-Fi) | [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) Phase D: prepared devices open within 2-3 minutes; fresh devices entering codes at N = 10, 25, 40; record sessions obtained, 429s, Auth log entries | All prepared devices GREEN within 3 minutes; fresh enrollment succeeds or fails with a clear message and a staggered-entry fallback is documented; Auth limit value recorded (checklist 1.8.5) |
| G3 | **Real-device offline recovery** | The harness models the sync loop; real IndexedDB, service worker and Wi-Fi loss are not exercised. The automated Playwright script is demo-mode by default; hosted mode needs a provisioned temporary conference | Staff on real laptops/phones; Harness operator for the hosted Playwright mode | [STAFF_REHEARSAL.md](STAFF_REHEARSAL.md) step 6 (offline Chair action, reconnect, "needs review") and [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) offline steps 1-12; optionally `npm run test:rehearsal:offline` in hosted mode ([OFFLINE_REHEARSAL_AUTOMATED.md](OFFLINE_REHEARSAL_AUTOMATED.md)) | Zero lost, zero duplicated actions; PT409 resolved with an exported recovery file; second device matches (checklist 1.7.1-1.7.7). Demo-mode results are **not** hosted evidence |
| G4 | **Storage / photo paths** | The harness simulates a `photoAck` step but uploads no object; `/api/health` Storage check and photo routes are unexercised under load | Technical contact (health, signed URLs); Harness operator for a small scripted upload | Checklist 1.5.5 (Storage check `ok` with the server key) and 1.9 photo workflow on a labelled conference; measure upload and signed-read latency at low concurrency | Storage health `ok`; photo upload and read succeed; objects removable by the guarded cleanup (Storage objects are in scope of cleanup step 6) |
| G5 | **Realtime fan-out** | The harness **simulates** Realtime notifications after each write; real channel subscriptions are not opened (`npm run test:load`'s real channels are excluded from this plan, [Verified]) | Technical contact with real browsers; optionally `LOAD_CLIENTS` of at most 50 with `npm run test:load` only if separately approved | STAGING_REHEARSAL E2 (block `*/realtime/v1/*`), plus watch Realtime logs and connection counts during H3 with a few real devices | Core actions continue with Realtime blocked; recovery reads within about 60 s or on refocus; no Realtime errors at 110 real connections is [Untested] and may be accepted only by an explicit owner decision |
| G6 | **Public submission HTTP check needing `SUPABASE_SECRET_KEY`** | `scripts/verify-submission-http.mts` asserts a server key, uses a hard-coded `http://localhost:3001` origin and `supabase/fixture-ids.json`; it overwrites `docs/submission-http-results.json`. **Not run** (checklist 1.5.1-1.5.3) | The owner provides `SUPABASE_SECRET_KEY` in an ignored `.env.local` (never to an agent, never printed); technical lead runs it with approval | Start `next start -p 3001` locally against the preproduction project, run `npx tsx scripts/verify-submission-http.mts`; **adapt or skip by owner decision** because the fixture ids are from the former seed | Script passes against a current fixture; results not committed over the tracked file; key removed afterward (cutover credential revocation) |
| G7 | **Backup and restore** | Nothing in the load tooling touches backups; no restore procedure exists ([Verified] checklist 1.10.6 OUTSTANDING) | Owner (dashboard state, decisions); Codex reviews; technical lead exercises | Record backup/PITR state (P9); write the restore procedure; exercise a restore on **local or disposable state** (no hosted restore project without owner approval, lifecycle) | Procedure written and independently reviewed; restore exercised locally; acceptable data loss and downtime recorded with approval. PITR decision made **before real data** |

All of G1-G7 are checklist or lifecycle requirements at Small ("separate delegate bursts and shared-NAT enrollment, offline/reconnect/restart, overload, role/revocation, failure and rollback rehearsals", [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) pre-cutover evidence 5). They compete for the same 31 October to 2 November calendar as the load stages; see the schedule section of [LOAD_TEST_PLAN.md](LOAD_TEST_PLAN.md).

## 14. Approvals needed before ANY hosted action

Nothing is approved. Each line needs the owner's written approval (recorded in [VERIFICATION.md](VERIFICATION.md)); items marked R also need Codex review; items marked J also need John Paul Ribeiru where they change the release.

1. The exact commands of sections 3-5 and the window (UTC and Qatar time), confirmed to end before real data and before cutover. (R)
2. Compute upgrade to Small on this same project and its cost; whether an S0 smoke may run on Micro first; PITR and backup decisions. No upgrade is made by this packet.
3. Applying `fixture.sql` and `cleanup.sql` for fixture A, fixture B and any rerun fixture; creating the identity pool (22 anonymous users); the Preview with the server key; deleting it afterward.
4. The two protected conference ids and the delegate count (420 assumed).
5. The write path that ships (gateway, or the existing direct RPC path under an explicit owner-approved scope change that defers the gateway and does not meet the original gateway requirement) and therefore the path under test. (R, J)
6. People: who holds the harness, watches, decides go/no-go, times the settle, may stop; whether H4 runs and who closes votes and how they get access.
7. Reruns: a contingency approval for a rerun of a failed stage on 1 November (the plan requires each rerun to be approved).
8. The guarded deletion procedure for cutover (not yet written). (R)
9. The separate checks G1-G7, each with its own scope.

## Appendix A: command and flag cross-check

Each row was confirmed by reading the cited file on this commit (and, where noted, by running the local no-network command).

| Command or flag | Where confirmed |
| --- | --- |
| `npm run rehearsal:identities` (`--chairs`, `--pace-seconds`, `--dir`, `--out`) | `package.json`; `scripts/rehearsal-identities.mts` header |
| `npx tsx scripts/prepare-session.mts` | `scripts/prepare-session.mts`; imported assumptions in `scripts/remote-context.mts` |
| `npx tsx scripts/rehearsal-fixture.mts` (`--identities`, `--committees`, `--delegates`, `--grant-hours`, `--legacy-floors`, `--floors`) | `scripts/rehearsal-fixture.mts` |
| `npx tsx scripts/rehearsal-snapshots.mts` (`--identities`, `--fixture`, `--reads`, `--worst-case`, `--components`, `--all-chairs`) | `scripts/rehearsal-snapshots.mts` header and body |
| `npm run rehearsal:run` (`--app`, `--identities`, `--fixture`, `--staff`, `--stages`, `--minutes`, `--delegates`, `--delegate-window`, `--submit-token`, `--submit-committee`, `--submit-fraction`, `--realtime`, `--executive-chair-window`, `--drain-seconds`, `--start-window`) | `scripts/rehearsal-run.mts` |
| `npm run rehearsal:plan` (`--staff`, `--delegates`, `--minutes`, `--committees`, `--start-window`, `--delegate-window`, `--submit-fraction`, `--read-ms`, `--send-ms`, `--realtime`, `--executive-chair-window`) | `scripts/rehearsal-plan.mts`; run locally on this commit |
| `npm run test:load` (`LOAD_CLIENTS`), excluded from the hosted plan | `package.json`; `scripts/load-test.mts` |
| `npm run test:rehearsal:offline`, `REHEARSAL_BUILD`, hosted mode | `package.json`; [OFFLINE_REHEARSAL_AUTOMATED.md](OFFLINE_REHEARSAL_AUTOMATED.md) |
| `scripts/verify-submission-http.mts`, `SUPABASE_SECRET_KEY`, origin `http://localhost:3001` | `scripts/verify-submission-http.mts` |
| `checkToolTarget`, `assertToolTarget`, `targetConfig` | `lib/platform/target-guard.ts` (one-liner in P3 run locally) |
| `checkFixtureConference`, `NEXT_PUBLIC_CONFERENCE_ID`, `PROTECTED_CONFERENCE_IDS`, `checkAppUrl`, `checkHealthEnvironment`, `MAX_USERS` 200 | `scripts/rehearsal/guard.ts` |
| `MAX_SINGLE_LINK_SUBMISSIONS` 18, `DOCUMENTED_SUBMIT_FRACTION` 0.1, `capacityGateLabel` | `scripts/rehearsal/readiness.ts` |
| `cleanupSql`, `cleanup.sql`, `load-cleanup.sql` | `scripts/rehearsal/fixture.ts`; `scripts/rehearsal-fixture.mts`; `scripts/prepare-load.mts` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` (`x-vercel-protection-bypass`) | `scripts/rehearsal-run.mts` |
| Report path `.test-sessions/rehearsal-<time>.json`; `.test-sessions/` git-ignored | `scripts/rehearsal-run.mts`; `.gitignore` |
| No-network guard test | `tests/load-guard-no-network.test.ts` |

Not used by this packet, deliberately: `--stages` (no go/no-go, evaluates once), `npm run test:load` (single identity, unpaced), any flag not listed above.
