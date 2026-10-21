# Conference-scale load test plan

Status: **PROPOSED, NOT APPROVED.** Written 21 October 2026 for the 5-7 November conference. Nothing in this document has been run against a hosted project. **The hosted load test MUST NOT run until the owner approves scope and timing** ([Owner approval](#owner-approval-required-before-any-hosted-run)).

This plan sits on top of the existing harness and does not replace [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md), which stays the source for phases A-F, the harness description and the historical measurements. This document adds: the derived conference model, an explicit test-data isolation design, ramp and sustained phases with request rates, the metrics to capture, hard stop conditions, cleanup, the Micro versus Small comparison, and a local dry run.

Related: [LOAD_TEST_EXECUTION_PACKET.md](LOAD_TEST_EXECUTION_PACKET.md) (operator-ready execution packet and separate-check gaps; prepared, not approved), [DEPLOYMENT.md](DEPLOYMENT.md) (target guard, single-project cutover), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (project state), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (conference-week gate), [RELIABILITY.md](RELIABILITY.md), [PT409_FIX_REPORT.md](PT409_FIX_REPORT.md).

## 1. Conference model and expected concurrency

### Sources and assumptions

| Input | Value | Source / status |
| --- | --- | --- |
| Conference dates | 5-7 November 2026 | [TEST_COVERAGE_REVIEW.md](TEST_COVERAGE_REVIEW.md), [DEPLOYMENT.md](DEPLOYMENT.md) |
| Release gate | 110 devices across 19 real committees on Pro + Small | root `AGENTS.md`, [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) |
| Staffing | 57 Chairs (about 3 per committee, 1-2 active), about 10 Approval devices, 5-6 printing (Logistics) devices, Executive and spares | [UI_PRIORITY_PASS.md](UI_PRIORITY_PASS.md), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) |
| Delegates | **Not recorded in the repository.** Assumption: **420 delegations** (about 22 per committee, the fixture default); sensitivity case 570 (30 per committee) | ASSUMPTION. The owner must confirm the real number |
| Delegates are not app users | They only load `/submit/{token}` and POST `/api/submissions`; no Supabase Auth session | [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) |
| Staff refresh | Realtime event, debounced 350 ms; recovery poll about every 60 s (harness `RECOVERY_MS`); production `lib/sync/backoff.ts` polls every 120 s with Realtime connected and 60 s without (both +/-20 % jitter); access poll about 60 s | `scripts/rehearsal/client-model.ts`, `lib/sync/backoff.ts`, `lib/repository-instance.ts` |
| Snapshot | One bundled RPC per refresh: `conference_state_snapshot` (Chair, Approval, Logistics) or `executive_state_snapshot` (Admin-only) | `lib/supabase/repository.ts`, [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) |
| Snapshot sizes (fresh fixture, measured) | Chair 11.9 KB, Approval/Admins 10.8 KB, Executive 121 KB; Executive 170 KB after 729 changes; same identity via `conference_snapshot` 474 KB | [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md). These were measured on 14 committees / 420 delegates; **19 committees will be larger. Re-measure** with `rehearsal-snapshots.mts` (step L4) |
| Public submission limit | 20 accepted per link per 10 minutes (resolution and amendment links); harness refuses to plan more than 18 | migration `20261007104501`, `scripts/rehearsal/readiness.ts` |
| Auth | Default 30 anonymous sign-ins per IP per hour (confirm in dashboard) | [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) Phase D |

### Derived concurrent users

* **Connected staff devices (design point): 110.** The owner's profile is 57 Chairs + about 10 Approval + 5-6 Logistics + Executive/spares = roughly 75-110 connected devices, so 110 is the upper bound including idle spares.
* **Active Chair devices: 19-38** (1-2 per committee). The harness default mix (70/10/10/10) puts **77 Chair, 11 Approval, 11 Admins, 11 Executive** devices on the 110 and spreads them over 19 committees. That is more active Chairs and many more Executive devices than the real conference, so it is a **conservative** (heavier) load. The Executive device is the most expensive reader (121-170 KB snapshot, 115-255 ms DB time versus about 65 ms for a Chair).
* **Delegate public traffic: 150-200 page loads in about 2 minutes** after "submissions open", and at most 18 real submissions per link per 10 minutes. Across 19 links the theoretical ceiling is 19 x 20 = 380 accepted per 10 minutes (0.63 per second). The harness exercises one link; the multi-link figure is extrapolated, not tested.
* **Auth identities:** 0 for delegates; one anonymous identity per staff device that has redeemed an access code. In the test, 19 Chair + Approval + Admins + Executive = **22 pooled identities** (one Chair identity per committee), shared by all simulated devices of that role. This is **not** a 110-distinct-user sign-in test; Phase D covers fresh sign-ins separately.

### Request rates implied by the commands in section 4

All figures are the deterministic scenario (seed 42, 19 committees, 150 s start window) as computed by `scripts/rehearsal/scenario.ts` and `scripts/rehearsal/estimate.ts` on 21 October 2026 (`npm run rehearsal:plan` uses the same code). Writes are an **upper bound** (the live runner skips a step whose precondition is not met). Snapshot RPC counts are the client-model estimate with Realtime `topic-aware`, the 2 s Executive Chair window and an assumed 600 ms refresh (2.5 s in brackets); the live run reports the real count. Rates are averages over the whole run **including the start burst**, so a 5-minute run reads higher per minute than the 30-minute run.

| Invocation | Staff mix (Chair / Approval / Admins / Executive) | Committees with Chair traffic | Staff writes | Snapshot RPCs |
| --- | --- | --- | --- | --- |
| S0: `--staff 10 --minutes 5` | 7 / 1 / 1 / 1 | **7 of 19** | 106 (21 per min) | about 199 (40 per min) |
| R1: `--staff 25 --minutes 5` | 16 / 3 / 3 / 3 | **16 of 19** | 252 (50 per min) | about 609 (122 per min, 2.0 per s) [525] |
| R2: `--staff 50 --minutes 5` | 35 / 5 / 5 / 5 | 19 | 463 (93 per min) | about 1,574 (315 per min, 5.2 per s) [1,327] |
| R3: `--staff 80 --minutes 5` | 56 / 8 / 8 / 8 | 19 | 702 (140 per min) | about 3,325 (665 per min, 11.1 per s) [2,629] |
| H3: `--staff 110 --minutes 30` (+150 delegates) | 77 / 11 / 11 / 11 | 19 | 3,841 (128 per min) | about 27,206 (907 per min, 15.1 per s) [20,511] |
| H4 background: `--staff 50 --minutes 15` | 35 / 5 / 5 / 5 | 19 | 1,151 (77 per min) | about 4,386 (292 per min, 4.9 per s) [3,635] |

Per role for H3 (600 ms case): Chair about 14,800, Executive about 8,400, Approval about 2,000, Admins about 2,000 refreshes. Refreshes, not writes, dominate: the pass criteria watch snapshot read latency and API connection use first. (`npm run rehearsal:plan -- --staff 110 --delegates 150 --minutes 10 ...`, used in L2, prints a 10-minute scenario: 1,528 writes, about 9,995 snapshot RPCs; it is a plan-only figure and is **not** what H3 executes.)

Public form (H3): the scenario schedules **150 page loads uniformly at random inside the first 120 s** of the run (about 1.25 per second on average) and, with `--submit-fraction 0.08`, **16 resolution submissions**, each 30-180 s after its own page load, i.e. **between about 57 s and 282 s into the run**, all inside one 10-minute window on one link (limit 20, runner refusal above 18). At the default fraction 0.10 the same scenario plans **18** (no headroom; 0.05 plans 10; 200 delegates at 0.10 plans 22 and is refused).

## 2. Simulated workloads

| # | Workload | Real-world trigger | How it is simulated | Coverage |
| --- | --- | --- | --- | --- |
| W1 | **Roll call burst** | Session opens; every Chair marks about 22 delegates | Harness `attendance` steps (each Chair device marks up to 8 delegates, 3-8 s apart, right after opening; plus later roll-call writes), starting inside the 150 s start window. Worst realistic case: 19 Chairs x one write per 3 s = about 6.3 writes per second for about 66 s | Harness (human-paced). A faster-than-3 s burst is deliberately not modelled |
| W2 | **Speaker queue and score writes** | Debate | `queueAdd`, `speechStart`, `speechScore`, `speechFinish`, POIs; one floor device per committee | Harness |
| W3 | **Votes closing simultaneously across committees** | The Chair of every committee closes a vote at the end of a session | **Not in the harness** (no vote action). Only possible as an optional **people-driven scenario** (H4, decision 11): up to 19 people close one vote each within a 10 s window, 3 rounds, while the harness runs 50 staff in the background. Expect 19 `apply_conference_mutation` calls in about 10 s plus a refresh wave on Approval/Admins/Executive devices | **Gap**, manual and optional. Who performs it, and how they get staff access to the temporary conference, is an owner decision. Do not add harness features during the freeze |
| W4 | **Approval / Logistics polling** | Panels left open all day | 11 Approval + 11 Admins devices: focus returns every 30-90 s, recovery poll, topic-aware (ignore `chair` events), occasional approve/print | Harness |
| W5 | **Public submission burst** | "Submissions open" announcement | `--delegates 150`, `--delegate-window 120`, `--submit-token <token> --submit-committee <code> --submit-fraction 0.08`: 150 page loads in the first 120 s of the H3 run plus 16 real submissions (at about 57-282 s) on one link. This starts with the run, not later | Harness |
| W6 | **Snapshot reads** | All of the above | Every device runs the production sync model (one flush in flight, 350 ms debounce, 60 s recovery); `rehearsal-snapshots.mts` measures bytes and unloaded latency per role | Harness + probe |
| W7 | Realtime connect / reconnect | Wi-Fi blips | `npm run test:load` (up to 200 channels) is **not** used for the hosted run (see below); Realtime behaviour is observed through the harness's simulated notifications and Phase E2 with real browsers | Partial |
| W8 | Duplicate / lost-response retries | Flaky venue Wi-Fi | 10 % of writes re-sent with the same mutation id; exactly-once check | Harness |

`npm run test:load` (`scripts/load-test.mts`) is a single-identity burst test with no pacing. It remains available but is **not part of this plan's hosted phases**; if it is ever approved, use `LOAD_CLIENTS=50` at most on Small.

## 3. Test-data isolation

### Principle

All hosted traffic goes to a **dedicated TEMPORARY conference** (fresh random UUID, name starting `LOAD TEST ·`, venue `TEST DATA`) inside the **staging project** `kllhswucdhqqywnzxado`, using **its own** freshly created anonymous identities and grants that expire within hours. It never uses the original conference (`0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`, "DCMUN Development Test"), the earlier temporary UI-test conference ([SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)), any real conference, or any production project.

### Layers of protection (what the code enforces)

1. **Project guard.** Every script resolves the project through `lib/platform/target-guard.ts` (`assertToolTarget`) before any connection: the URL must be a hosted `https://<ref>.supabase.co`, the ref must be in `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS`, never `EXPECTED_SUPABASE_REF` (production), and never the PHESMUN project `gglltljhdpkfjnyjmnif`. No allow-list means refuse. No override exists. Used by `remote-context.mts` (load-test, snapshots, rehearsal-run), `prepare-session.mts` and `rehearsal-identities.mts`.
2. **App guard** (`scripts/rehearsal/guard.ts`): `rehearsal-run.mts` only talks to `localhost` or a Vercel Preview/branch URL, refuses bare aliases and custom domains, and refuses a target whose `/api/health` says `production`.
3. **Fixture-conference guard (added with this plan).** `checkFixtureConference` is called by `load-test.mts`, `rehearsal-run.mts` and `rehearsal-snapshots.mts` **before any network request** (for `rehearsal-run` that includes the deployment's `/api/health`): the fixture must name a well-formed conference UUID that is **not** the configured `NEXT_PUBLIC_CONFERENCE_ID` and not in the optional comma-separated `PROTECTED_CONFERENCE_IDS`. It **fails closed**: if `NEXT_PUBLIC_CONFERENCE_ID` is missing, blank or not a UUID (or a `PROTECTED_CONFERENCE_IDS` entry is malformed) the tool refuses, because it cannot then show that the fixture differs from the protected conference. Before this change a mistaken fixture file could point the harness at the configured conference. `tests/load-guard-no-network.test.ts` runs the real scripts with fetch, sockets and DNS blocked and asserts zero attempts for a protected, malformed or unverifiable case.
4. **Database scoping.** The fixture SQL creates the conference, committees, one session each, delegations, a scoring definition, and `user_access` grants **only for that conference id** with `expires_at = now() + grant-hours` (default 3, max 12). RLS and the `apply_conference_mutation` role checks mean an identity with no grant on another conference cannot write to it. Fixture ids are derived from the conference id.
5. **Labelled data.** `LOAD TEST` in the conference name, `Load test <code>` committees, `Simulated delegate N` / `loadN@example.com`, so the cutover cleanup ([DEPLOYMENT.md](DEPLOYMENT.md#single-project-cutover) step 2) finds everything by label.

### Residual risks (honest list)

* **Shared instance.** The temporary conference shares CPU, memory, connection pool and Realtime with the original test conference. This is acceptable only because **no real conference data exists in the project yet**. The window closes at the real Executive bootstrap ([FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md)). After real data exists, the project must not be load tested at all; at cutover the ref moves to `EXPECTED_SUPABASE_REF` and the tools refuse it.
* **Preview server routes.** The public-form part runs through a Vercel **Preview** whose `SUPABASE_SECRET_KEY` points at the same project. The submission link used must belong to the fixture committee (created by the fixture Executive identity). Old Previews must be deleted at cutover (DEPLOYMENT step 3), including those used for this test.
* **The fixture guard knows one conference id** (`NEXT_PUBLIC_CONFERENCE_ID`). The id of the earlier temporary conference is not in any variable; the operator records both ids in the run sheet and checks them by hand (step H0).
* **Credentials.** Pool identities are anonymous users created for the test (`rehearsal-identities.mts`: paced, capped at 25 sign-ins per run, below the 30 per IP per hour default). Their session files live in the ignored `.test-sessions/` (mode 0600) and are never printed or committed. One operator holds them at a time (refresh tokens rotate). The service/secret key is never given to the load scripts.

### Isolation checks the operator performs

* H0 (before): `.env.local` ref is `kllhswucdhqqywnzxado`; that ref is listed in exactly one of `STAGING_SUPABASE_REFS` or `DEVELOPMENT_SUPABASE_REFS` (an operational choice; the guard accepts either); `EXPECTED_SUPABASE_REF` is **unset** in the operator shell; `NEXT_PUBLIC_CONFERENCE_ID` is **set** to the original conference (the guard refuses otherwise) and `PROTECTED_CONFERENCE_IDS` lists the earlier temporary conference; each fixture conference id differs from both recorded ids.
* Baseline fingerprint of the original conference, recorded read-only in the Supabase SQL editor (replace `<ORIG>`):

```sql
select (select count(*) from public.operational_changes where conference_id = '<ORIG>') as changes,
       (select max(created_at) from public.operational_changes where conference_id = '<ORIG>') as last_change,
       (select count(*) from public.user_access where conference_id = '<ORIG>' and revoked_at is null) as active_grants,
       (select count(*) from public.documents where conference_id = '<ORIG>') as documents,
       (select count(*) from public.attendance where conference_id = '<ORIG>') as attendance,
       (select count(*) from public.audit_log where conference_id = '<ORIG>') as audit_rows;
```

Run the same query before, at the end of each phase, and after cleanup. Any difference is a STOP condition (and a cleanup failure).

## 4. Phases, exact commands and what the runner does

### What `scripts/rehearsal-run.mts` actually does (read from the code, 21 October 2026)

* **Local preflight first, no network:** app URL shape (localhost or a Vercel Preview/branch URL), user and delegate limits (1-200), the planned single-link submissions (refuses above 18), the Supabase project guard, the fixture-conference guard (fails closed; see [section 3](#3-test-data-isolation)). Only after all of these does it request the deployment's `/api/health` (which may itself contact the database, Auth and Storage) and refuse if the environment is `production` or unknown. A regression test runs the real scripts with `fetch`, sockets and DNS blocked and asserts zero attempts on every refusal.
* **One invocation = one or more stages** (`--stages 25,50` or `--staff N`). For each stage in order it builds the scenario, waits 1 s, then runs all steps; staff open inside a **150 s start window** (`--start-window`), steps end at `--minutes`, then it **drains** up to 120 s (`--drain-seconds`) until every outbox is empty, then **starts the next stage immediately**. There is **no go/no-go between stages, no settle period, no stop-on-threshold and no automatic abort**. Thresholds are evaluated **once, at the end, over all samples of all stages**; the exit code is 1 if that verdict fails. Stopping early is only Ctrl-C (which discards in-memory outboxes).
* **Labels.** A multi-stage report takes the label of its **worst** stage (one under-covered stage makes the whole report `NOT A READINESS RUN`) but the capacity-gate text of its **largest** stage. `--minutes` has no upper bound; staff and delegates are each capped at 200.
* **Delegates** are scheduled per stage relative to that stage's start, not to a later minute. With a submit token they load `/submit/<token>` and POST `/api/submissions`; without one they request a deliberately invalid link.
* **Not done by the runner:** creating fixtures or identities, applying SQL, creating the submission link, reading Supabase dashboards or logs, closing votes, cleanup. Those are manual steps below.

For these reasons this plan uses **only single-stage invocations (`--staff N`), never `--stages`**, with an operator go/no-go and a manual two-minute settle between them.

### Invocations

Common arguments `COMMON` = `--app <preview-url> --identities <fixture>/identities.json --fixture <fixture>/fixture.json` (realtime `topic-aware` and Executive window 2000 ms are the defaults). Every hosted invocation needs the approvals in [Owner approval](#owner-approval-required-before-any-hosted-run).

| ID | Fixture | Command | Duration (about) | Classification of its report |
| --- | --- | --- | --- | --- |
| **L0** | none | local dry run, [section 10](#10-local-dry-run-no-hosted-calls) | 30 min | not a hosted run |
| **S0 Smoke** | A | `npm run rehearsal:run -- COMMON --staff 10 --minutes 5` | 5 + up to 2 min drain | `NOT A READINESS RUN` (Chair traffic in 7 of 19 committees). Proves guards, identities, grants and metrics capture only. Its verdict can never PASS |
| **R1 Ramp 25** | A (reused) | `... COMMON --staff 25 --minutes 5` | 5 + drain | `NOT A READINESS RUN` (16 of 19 committees, "no Chair traffic for 3 committee(s)"). Partial: a ramp step only |
| **R2 Ramp 50** | A (reused) | `... COMMON --staff 50 --minutes 5` | 5 + drain | Structurally `READINESS RUN` (all 19 committees, 19 Chair identities) but **below the 110-device gate**: the runner prints "BELOW the current 110-device gate". Does **not** count toward the gate |
| **R3 Ramp 80** | A (reused) | `... COMMON --staff 80 --minutes 5` | 5 + drain | Same as R2 |
| **H3 Gate** | B (fresh) | `... COMMON --staff 110 --minutes 30 --delegates 150 --delegate-window 120 --submit-token <token> --submit-committee <code> --submit-fraction 0.08` | 30 + drain | The **only** report that can count as the 110-device / 19-committee gate: it must say `READINESS RUN` **and** "CURRENT capacity gate size (110 devices...)". See the public-form timing below |
| **H4 Spike** | B (after H3) | background `... COMMON --staff 50 --minutes 15` plus manual vote closures | 15 + drain | Partial/informational. **Optional and separately gated** (needs human access, see decision 11). Without it, W3 stays unverified |
| **H5 Recovery** | B | no command; dashboard only after all processes exit | 10 min | Observation |

Fixture A (smoke and ramp): `rehearsal-fixture.mts ... --committees 19 --delegates 420 --grant-hours 3`. The ramp invocations **reuse** it, which deviates from the "fresh fixture per run" rule: attendance, queue and audit history accumulate across S0-R3 and slightly inflate later snapshots, so ramp latencies are informational; the gate is H3 on fresh fixture B (`--grant-hours 4`, so that H3, H4 and H5 fit inside one grant lifetime). Each fixture needs its own owner-approved `fixture.sql` and `cleanup.sql`.

### Operator-controlled ramp (S0 -> R1 -> R2 -> R3 -> H3)

After **every** invocation, before starting the next, the operator (named in decision 5) does the following. The runner does none of it.

1. Read the printed verdict: the six automated checks (no duplicates, no lost writes, error rate under 1 %, no rate limits, worst per-action write p95 <= 1,500 ms, worst per-action read p95 <= 2,500 ms). For S0, R1, R2 and R3 the readiness line is expected to say what the table above says; only the six metric checks count for go/no-go.
2. Check the Supabase dashboard and logs for that run window against the manual items in [section 6](#6-passfail-thresholds) and every stop condition in [section 7](#7-stop-conditions); re-run the original-conference fingerprint.
3. **Settle for two minutes (manual, timed by the operator):** database connections idle, CPU and IO back near baseline, no `PGRST003` or `40001` in the logs. If not back to baseline after a further 3 minutes, stop.
4. Write **go** or **no-go** in the run sheet with the time. Go only if 1-3 are clean. A no-go ends the ramp; do not skip to a larger stage.
5. Next invocation.

The ramp is S0, then R1, R2, R3, then **H3 on a fresh fixture B**. H3 is itself the 110-device stage; there is no separate 110-device ramp step. Expected hosted time for S0-R3 including reviews and settles: about 50 minutes; H3: about 35 minutes.

### H3 gate: what actually executes

* 110 staff (77 Chair, 11 Approval, 11 Admins, 11 Executive) across 19 committees for 30 minutes: about 3,841 writes (128 per minute) and about 27,200 snapshot RPCs (about 900 per minute, 15 per second) at an assumed 600 ms refresh.
* **Public traffic starts with the run, not at minute 10.** All 150 page loads land in the first 120 s and the 16 submissions at about 57-282 s, **overlapping the staff start burst** (all 110 devices open within the first 150 s). That is a harsher combination than a delayed burst. A delayed burst is not available without new, separately reviewed tooling and is **not** part of this plan.
* The runner prints `Stage 110 staff: 150 public page loads, 16 resolution submissions planned on one link (max 18).` before any request. The operator confirms the number **16** (the count depends on seed, minutes, delegates, fraction, staff and committee count; it was computed for exactly these parameters) and stops if it differs.
* The submission link must belong to the fixture committee named by `--submit-committee` (created on the Preview by the fixture Executive identity).

### Out of scope

No 150-200 staff stress run (not expected at this conference, [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md)); no `npm run test:load`; no fresh-staff-sign-in burst (Phase D) in this approval; no failure injection (Phase E). Each would need its own approval.

### Plan versus runner

| Phase | Exact command | What the runner actually does | Manual steps |
| --- | --- | --- | --- |
| L0 | `npm test`, `npm run rehearsal:plan`, fixture generation with placeholder identities | Local only; plan prints a 10-minute scenario | Delete `.test-sessions/` |
| S0 | `rehearsal:run COMMON --staff 10 --minutes 5` | One stage: health after local guards, 10 devices, 7 committees, 5 min, drain <= 2 min, verdict | Operator go/no-go and fingerprint |
| R1 | `... --staff 25 --minutes 5` | One stage, 16 committees, same fixture A | Go/no-go, 2-min settle |
| R2 | `... --staff 50 --minutes 5` | One stage, 19 committees | Go/no-go, 2-min settle |
| R3 | `... --staff 80 --minutes 5` | One stage, 19 committees | Go/no-go, 2-min settle |
| H3 | `... --staff 110 --minutes 30 --delegates 150 --delegate-window 120 --submit-token T --submit-committee C --submit-fraction 0.08` | One stage; 150 page loads in first 120 s; 16 submissions at about 57-282 s; drain <= 2 min; verdict; exactly-once check | Create link and fixture B beforehand; dashboards watched live; stop conditions applied by a person |
| H4 | `... --staff 50 --minutes 15` in the background | One stage; the runner has **no vote action** | People close votes in the app; needs staff access (decision 11) |
| H5 | none | none | Dashboard observation for 10 minutes |
| Cleanup | `cleanup.sql` for A and B | not run by the runner | Apply, verify, delete local files, fingerprint |

The delegate-form and fresh-sign-in tests (Phase D) stay as defined in [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) and are not approved here.

## 5. Metrics to capture

Capture for the exact run window (UTC start and end written in the run sheet).

### Client side (harness report, `.test-sessions/rehearsal-<time>.json`)

* Per action: requests, ok, **conflicts** (PT409 / HTTP 409), rate-limited (429), errors; p50 / p95 / p99.
* Read p50/p95/p99 per role; write p50/p95/p99; page-load p95 and submission outcomes.
* Triggers attempted/dropped, refreshes by source, snapshot RPCs sent (`snapshotRpcsByName`), outbox drain time, exactly-once check (duplicates, lost writes), `READINESS RUN` label and Chair/committee coverage.

### Server side (Supabase dashboard and MCP/CLI reports, read-only)

| Signal | Where | Notes |
| --- | --- | --- |
| **p50/p95/p99 of `apply_conference_mutation` and snapshot RPCs** | Harness gives client-observed percentiles. `pg_stat_statements` gives mean/max DB time per statement (it does **not** give true percentiles). API edge logs (`query_logs`, service `api`) give per-request status and timing for `POST /rest/v1/rpc/apply_conference_mutation` and `.../rpc/conference_state_snapshot` / `executive_state_snapshot` | Compare client vs server time to separate network (about 250 ms to ap-south-1 from a cloud container) from DB time |
| **Error and conflict rates** | Harness + API logs | Count separately below |
| **409 / PT409 versus real failures** | PT409 (HTTP 409) is an **expected stale-edit conflict** that is kept for review, not an error. **Real failures:** 5xx, `PGRST003` (pool wait), SQLSTATE `57014` (statement timeout), `40001` (serialization; PostgREST retries it, so any occurrence is a regression against [PT409_FIX_REPORT.md](PT409_FIX_REPORT.md)), `22023`/`42501` where unexpected, 429, 401/403 on granted identities | Report conflicts per 100 writes; roll call with several Chairs per committee is the main source |
| **Postgres connections** | Observability: database connections; `select state, count(*) from pg_stat_activity group by 1` | Small limit 60 direct (Micro) / 90 (Small); PostgREST API pool in this repo's measurements was about 10-11 connections |
| **CPU, memory, swap** | Observability: CPU, RAM | Shared-CPU instances; watch sustained use, not spikes |
| **Disk IO** | Observability: disk IO bandwidth and IOPS, and the IO-budget view | Burst-based instances can degrade after the burst budget is spent; sustained H3 is the test of this |
| **Slow queries / locks** | `get_advisors` (performance and security), `query_logs` (postgres), `pg_stat_statements`, `pg_locks` | Advisors before and after: no new findings |
| **PostgREST limits** | API logs: 429, `PGRST003`, 504/502 gateway errors | |
| **Auth rate limits** | Auth logs: anonymous sign-ins, token refresh, `over_request_rate_limit` | Expect near-zero during every phase (pool identities pre-created) |
| **Realtime** | Realtime logs and Observability (connections, messages) | 110 devices is far below documented plan limits; still record |
| **Vercel** | Logs/Functions: 5xx, duration of `/api/*`, `/submit/*`, `/api/health`; function concurrency and timeouts | Region `bom1` ([vercel.json](../vercel.json)); read the team's current limits in the dashboard |
| **Real devices** | One real Chair browser kept open; System health page | Subjective responsiveness |

## 6. Pass/fail thresholds

Starting points, inherited from [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) readiness criteria and from `evaluate()` in `scripts/rehearsal/metrics.ts`. Record actuals; adjust only with the owner and an independent reviewer. The last column says who checks it: **runner** means the harness computes it and prints PASS/FAIL; **operator** means a person reads it from the dashboard, logs or SQL. Nothing marked operator is enforced by code.

| Metric (H3 gate, 110 staff / 19 committees) | PASS | Checked by |
| --- | --- | --- |
| Run label | `READINESS RUN` and capacity text "CURRENT capacity gate size (110 devices...)" | runner (label); operator reads it |
| No duplicate writes, no lost acknowledged writes | 0 and 0 | runner (exactly-once check on scoring mutations) |
| Error rate (samples with outcome `error`, conflicts and rate-limited excluded, over **all** samples including reads) | < 1 % | runner |
| Rate-limited responses (429) | 0 | runner |
| Write p95 | <= 1,500 ms. The runner uses the **worst per-action p95** (for 12-13-sample actions that is their single slowest request); the aggregate write p95 is reported separately and read too | runner (worst per-action), operator (aggregate) |
| Read p95 | <= 2,500 ms, worst per-action p95 over `refresh`, `open`, `read`, `refocus`, `postWriteRead`, `realtimeRefresh` | runner |
| p99 write / read | recorded; over 10 s is a WARNING needing an explanation | operator |
| Public page p95 | <= 2 s, no 5xx; planned submissions (16) all succeed; zero Auth activity from delegates | operator (the runner records page timings and counts 5xx as errors but has no page-p95 check) |
| Unexplained 5xx, `PGRST003`, `40001`, `57014` in logs | **0** | operator (5xx also raise the runner's error rate) |
| PT409 conflicts | reported; each explainable by concurrent roll call; none lost | operator |
| Postgres CPU | sustained average < 70 %, no 5-minute window above 85 % | operator |
| Connections | peak < 75 % of the plan limit; all idle after H5 | operator |
| Memory | no sustained growth over H3; no swap thrash | operator |
| Disk IO | no IO-budget depletion; IOPS/bandwidth not pinned at baseline | operator |
| Recovery (H5) | outbox drained (runner prints drain seconds and `pendingAtClose`) and connections idle within 5 minutes of stop | runner (drain), operator (connections) |
| Isolation | original-conference fingerprint identical; no write outside the fixture conference | operator |

Ramp go/no-go (S0, R1, R2, R3) uses the same six runner checks plus the operator items and stop conditions; their readiness label is as classified in section 4 and is not part of go/no-go.

## 7. Stop conditions

**The runner has no automatic abort and no threshold check during a run; every condition below is applied by a person.** Whoever is on call stops the run immediately (Ctrl-C the harness, then apply `cleanup.sql`) on any of:

1. **Any write to a real or original conference** (fingerprint difference, or a `conference_id` in API logs other than the fixture). Stop, do not resume, notify the owner, run the isolation checks.
2. **Error rate**: > 2 % real failures in any 60 s window, or > 1 % over 5 minutes (conflicts excluded).
3. **Latency**: write p95 > 5 s or read p95 > 8 s for 3 consecutive minutes; any single request > 30 s.
4. **Postgres CPU** > 90 % for 2 consecutive minutes.
5. **Connection saturation**: any `PGRST003`; database connections > 85 % of the limit; pool fully busy for more than 60 s.
6. **Memory** > 90 % or swap growing; **disk IO budget** depleted or IOPS pinned.
7. **Statement timeout** (`57014`) twice in a window, any `40001`, or any 5xx burst (>= 3 in 60 s).
8. **Auth rate limiting**: any 429 or `over_request_rate_limit` from Auth during any phase (the pool is pre-created; a sign-in attempt means something is wrong). Do not loop retries.
9. **PostgREST rate limiting** or any 429 on staff routes; **public form** 429 (means the plan exceeded the per-link limit).
10. Target guard or health check reports `production`, or the wrong project ref appears anywhere.
11. Anything unexpected on the **real** Supabase or Vercel production surface (alerts, deployments).
12. The owner or the person in charge says stop.

After a stop, do not restart on the same fixture, and do not continue the ramp. Record the time, cause and last good metrics; the next attempt needs a new approval for the changed scope.

## 8. Micro versus Small compute

### Known from Supabase's public compute documentation (fetched 21 October 2026; re-check, these change)

| | Micro | Small |
| --- | --- | --- |
| CPU | Shared | Shared |
| Memory | 1 GB | 2 GB |
| Direct database connections | 60 | 90 |
| Pooler clients | 200 | 400 |
| Baseline disk throughput | 11 MB/s | 22 MB/s |
| Burst disk throughput | 261 MB/s | 261 MB/s |
| Baseline IOPS | 500 | 1,000 |
| Burst IOPS | 11,800 | 11,800 |

So Small doubles memory, connection limits, baseline throughput and baseline IOPS; CPU is also shared on both. The burst figures are equal, which means a short test can look the same on both and a sustained test (H3, 30 minutes) is where they should differ.

### Not known (do not assume)

* **The project's actual plan and compute size.** The setup record says Pro and Micro but states these are *not verifiable through the connector* ([SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)). **The owner must confirm in the dashboard (Organisation -> Billing; Project -> Settings -> Compute and Disk): plan, compute size, disk size, and whether PITR / daily backups are enabled.** The public compute page does not state the PITR minimum size; confirm it in the dashboard before relying on PITR.
* How many CPU cores, burst-credit duration and the exact CPU share the shared instance gives for this workload; how PostgREST's internal pool size changes with compute (the repository measured about 10-11 API connections on the earlier, smaller tier; the tier of those runs is not certain: STAGING_REHEARSAL calls it Nano, the new project Micro).
* Any Auth, PostgREST or Realtime rate limit actually configured on this project (read them in the dashboard: Authentication -> Rate limits; API settings; Realtime settings).
* Vercel plan limits for the team (confirm in the dashboard).

### Expected differences and what to do

* Expect **Micro to fail the 110-device gate** or pass only with thin margin: earlier 100-staff runs on a smaller tier had read p95 4.3 s and the API pool at 10 of 11 connections even after the read-path fixes. These are evidence, not a prediction for this instance.
* Expect Small to help most with memory pressure (snapshots of 120-470 KB for Executive devices), connection headroom and sustained IO.
* **Recommendation (consistent with the existing setup doc and checklist): upgrade to Small before 5 November** ([SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md), [DEPLOYMENT.md](DEPLOYMENT.md)); [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) wants the gate at T-7 days, about 29 October (**superseded as a target by the owner's 31 October proposal below, which is T-5 days and is a conflict, see [Schedule targets and conflicts](#schedule-targets-and-conflicts)**). The previous guidance says load phases are not run on the smaller tier.
* **What to test on which:**
  * **Micro (current; only if the owner approves a baseline): L0 and the S0 smoke only** (10 staff). No ramp, no gate. It confirms tooling and gives a before number. R1 (25 staff) only with explicit extra approval.
  * **Small: S0, R1, R2, R3, H3, and H4/H5 if approved** (the full plan), then re-run only the failed phase after any fix, each re-run needing its own approval.
  * A compute change restarts the database briefly; schedule it outside any run and re-baseline the original-conference fingerprint afterwards.

### Schedule targets and conflicts

**Nothing in this section is approved and nothing is spent or scheduled by it.** The dates below are the owner's *proposed targets* (21 October 2026), not approvals: not for the Small upgrade or its cost, not for any hosted run, not for the cutover. Each hosted action still needs the written approval in [Owner approval required before any hosted run](#owner-approval-required-before-any-hosted-run). The operator steps are in [LOAD_TEST_EXECUTION_PACKET.md](LOAD_TEST_EXECUTION_PACKET.md). Status markers: **Verified** (read in the repository), **Proposed**, **Untested**.

| Date (2026) | Proposed target | Status |
| --- | --- | --- |
| Now to 30 Oct (Micro) | Review this plan and the packet; local L0-L6; owner decisions; if the gateway is chosen as the release path, build and review it (see conflict 3); identity pool the day before (22 identities, about 8 minutes); only an S0 smoke on Micro, and only if the owner approves a baseline | Proposed |
| **Sat 31 Oct** | Small upgrade (database restarts briefly; re-baseline the fingerprint), then the full load rehearsal in one block: S0, R1, R2, R3, then H3 (+ H5, and H4 if approved), cleanup the same day | Proposed; counts as the gate only if the path under test is the path that ships (conflict 3) |
| **Sun 1 Nov** | Fixes and reruns of only the failed phase; each rerun needs its own approval; cleanup of every fixture | Proposed |
| **Mon 2 Nov** | Cutover, **only if every gate passes** (lifecycle "Formal cutover"): guarded deletion of synthetic data, revocation, promotion, production build | Proposed; depends on conflicts 2-6 |
| **Tue 3 Nov** | **Change freeze** (releases, code and configuration): `CONFERENCE_FREEZE=1`, T-48 hours (checklist 4.2). The freeze does not itself ban ordinary conference data entry through authorised workflows; real data entry may only begin after cutover sign-off, and never overlaps load or destructive testing | Proposed |
| **5-7 Nov (Thu-Sat)** | Conference | Verified dates |
| 31 Oct - 7 Nov | Small compute window, eight days inclusive | Proposed; the upgrade and its cost are not approved; Untested whether Small can be held for exactly that window |

**Earlier placeholders now superseded (flag, not silently dropped).** The earlier text of this plan had: 24-26 Oct upgrade to Small; 27-29 Oct load day (placeholder, never an agreed window); 30-31 Oct fixes and release freeze; 1-4 Nov no load tests and test-data removal. Under the owner's proposal the load day moves two to four days later, the change freeze moves from 30-31 Oct to 3 Nov, and fixes/reruns compress into one day. [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (T-7, about 29 October) and [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) still carry the earlier dates and need an owner decision to align (not edited here).

**Conflicts the owner must resolve** (each also stated in the packet where it affects the run):

1. **Rehearsal later than the earlier deadline.** 31 October is T-5 days, not the T-7 (about 29 October) in RELEASE_CHECKLIST.md, and the earlier 27-29 October placeholder is dropped. A failed H3 on 31 October leaves exactly one day (1 November) for diagnosis, a fix, review, redeploy and a rerun, and none for a second rerun. Verified arithmetic; the rerun duration is Untested.
2. **Ramp stages need time while the project is still on Micro.** [Verified] this plan and checklist 1.8.1 say Micro runs only L0 and an S0 smoke (R1 only with extra approval) and no ramp or gate. The stages S0-R3 therefore cannot give useful evidence before 31 October. Either they all run on 31 October after the upgrade (the plan's own about 5-hour block: S0-R3 about 50 minutes, H3 about 35, H4/H5 about 30, plus setup and cleanup, with no slack for a stop), or the owner approves Micro runs of S0-R3 as **development evidence only**, which proves tooling, not capacity. A slipped or slow upgrade slips everything after it. Proposed: approve S0 on Micro early to prove tooling, keep R1-R3 and H3 for Small.
3. **Write-path dependency (depends on which path the owner approves; nothing is decided).** The final capacity run **must exercise the write path that actually ships**. [Verified] [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) is a design for review; none of its register, marker, migrations, gateway route, `SupabaseTransport` change or harness change exists, and the lifecycle's original gate 6 requires a production-only write gateway. Two options, for the owner to choose in writing (decision D1):
   * *Gateway ships:* an H3 run must go through the gateway-capable build, so a direct-path run on 31 October is development evidence only. The 31 October gate is achievable **only if** the gateway, the harness change and the additive migration are reviewed and deployed to a protected preproduction Preview before then; otherwise the gate falls to 1 November (the rerun day) with no slack.
   * *Direct path ships under an owner-approved scope change* (the existing direct RPC architecture is retained for this conference and the gateway and attestation system are deferred): a direct-path H3 **can** count as the gate and there is no gateway dependency on the schedule. That scope change does **not** satisfy the original production-only write-gateway requirement and must say so, with compensating controls; the other lifecycle gates still apply.
   Until the owner decides, a direct-path run is recorded as gate-eligible only if the direct path is the approved release path. See the packet, section 11.
4. **Small window overlaps the change freeze, cutover and conference.** [Verified] the window 31 Oct - 7 Nov contains the cutover (2 Nov), the change freeze (3 Nov) and the conference. That is consistent with the lifecycle (Small before and through the conference) but means Small is billed during the days that carry no load testing. Load, destructive and write-isolation tests must **finish before real data exists and before the cutover**; after promotion no load or rehearsal runs ([Verified] INFRASTRUCTURE_LIFECYCLE.md). A compute change restarts the database: do it outside any run and not during the cutover write pause.
5. **Cleanup must precede promotion.** [Verified] revoke-only `cleanup.sql` is not the cutover step: the guarded deletion of the labelled test conferences, grants and auth users (cutover step 2; checklist 1.9.5, 2.2) is **not written**. It needs review and approval and must run after the last synthetic test, which is the 1 November rerun, and before 2 November's promotion. Revoke-only cleanup of every fixture is due the same day as its run.
6. **Isolation proofs and revocation wait-out sit inside the same two days.** [Verified] the lifecycle requires, after all load tests and before real-data entry, revocation of test credentials and sessions with a wait-out of any remaining token validity, and proof of target/lock behaviour. If the gateway is the release path, ISOLATION_DESIGN.md rollout steps 6-9 add the evidence phase, production-classified synthetic proofs, key rotation, token floor and an attestation barrier of about 25 minutes (proposed values); if the direct path ships under a scope change those gateway-specific steps fall away but the lifecycle's remaining gates and the token wait-out do not. Cutover on 2 November and the change freeze on 3 November leave about one day for the real Executive bootstrap, real data entry, codes and QR links ([V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) phase 4). The freeze concerns releases, code and configuration, not ordinary data entry through authorised workflows, but real data cannot be entered before cutover sign-off. Whether this fits is Untested.
7. **Other required rehearsals compete for the same days.** [Verified] the lifecycle requires, at Small and before promotion, separate delegate bursts and shared-NAT enrollment, offline/reconnect/restart, overload, role/revocation, failure and rollback rehearsals, and a restore exercise; the packet lists the separate checks (G1-G7) with owners and says which apply to the shipped feature set (for example the photo check covers the schedule/reminder/acknowledgement workflows and Storage health, not an image upload, which does not exist). They are not covered by H3 and are not in the owner's 31 October block. Those that do not need Small capacity can run earlier on Micro as functional evidence, but the lifecycle wants the decisive runs at Small.
8. **Weekend and availability.** 31 October and 1 November fall on a Saturday and Sunday (Verified by calendar). People and dashboard access for those days are not confirmed (Untested).
9. **Every rerun needs its own approval**, and a fixture is not reused after a stop ([Verified] section 7); the owner can pre-approve a contingency rerun on 1 November in the same written approval.

**Achievable only if upstream work lands (dependency table, Proposed):**

| Target | Achievable only if |
| --- | --- |
| 31 Oct upgrade and S0-R3 | The owner approves the Small upgrade and cost, plus the run, in writing by 30 Oct; identities prepared on 30 Oct; the Preview of a named commit is ready; P2-P17 of the packet are done |
| 31 Oct H3 counting as the gate | The path under test is the path that ships: either the gateway ships and the gateway, harness change and additive migration are reviewed and deployed on a Preview before 31 Oct, or the owner approves a scope change retaining the direct RPC path (then the direct-path H3 counts) |
| 1 Nov reruns | A finding is small enough to fix, get independent review (Codex, protected areas) and redeploy within one day; an approved contingency exists |
| 2 Nov cutover | All gates pass; guarded deletion script reviewed; isolation proofs (evidence suite) done; backup and restore exercised on local/disposable state; revocation wait-out accounted for; no real data yet |
| 3 Nov change freeze | The production build was released and verified on 2 Nov; the real Executive bootstrap and authorised data entry fit in the remaining time |

If any row above fails, the dates do not hold and the owner chooses between moving the cutover, accepting a recorded scope change, or not cutting over; this document makes none of those decisions.

## Owner approval required before any hosted run

**Status: awaiting owner decision. Nothing in this document is approved.** No hosted request has been made. This plan approves **no** hosted load, **no** fixture creation or SQL application, **no** identity creation, **no** compute or PITR upgrade and **no** spending. The dates below and in [Schedule targets and conflicts](#schedule-targets-and-conflicts) are targets and placeholders for discussion, not an agreed window, and nothing here extends or schedules any agreed Small-compute window. The owner (Zuhayr Siddique) must approve, in writing, the exact workload in section 4 (the commands, the 150-delegate burst in the first 120 s of H3 with 16 submissions, and the manual ramp) and each item below. Approve **the workload that will execute**, not a description of it. John Paul Ribeiru approves releases; Zuhayr Siddique is in charge during any live problem.

| # | Decision needed | Proposed default (pending the owner) |
| --- | --- | --- |
| 1 | **Date and time window** (start/end, UTC and Qatar time), with the confirmation that the window ends before the real Executive bootstrap and before any real conference data enters the project | Owner's proposed target 31 October (supersedes the earlier 27-29 October placeholder), with 1 November for fixes and reruns; one block of about 5 hours (S0-R3 about 50 min, H3 about 35 min, H4/H5 about 30 min, setup and cleanup) |
| 2 | **Size and phases**: which of S0, R1, R2, R3, H3, H4, H5 may run; maximum staff devices (110); delegates (150) and submissions on one link (16, runner maximum 18); acceptance that **H3 starts public traffic in its first two minutes** (not later) | S0-R3, H3, H5; H4 only if decision 11 is yes |
| 3 | **Compute tier**: confirm plan, compute and PITR from the dashboard; whether to upgrade to Small and on which date; whether to allow an S0 smoke on Micro | Recommend Small before any run beyond S0; the owner decides; no upgrade is made by this plan |
| 4 | **Delegate count** (420 assumed, **pending owner confirmation**; sensitivity 570) | 420 |
| 5 | **Who is on call**: Supabase and Vercel dashboard access, who holds the harness, who watches logs, **who makes each ramp go/no-go and times the two-minute settle**, who can stop the run | Claude runs the harness; the technical contact on the dashboards; the Executive observes |
| 6 | Applying `fixture.sql` and `cleanup.sql` for **two** fixtures (A for S0-R3, B for H3/H4) to the staging project, and creating about 22 temporary anonymous identities | Labelled, expiring in 3 hours (A) and 4 hours (B) |
| 7 | A Vercel Preview (named commit) with `SUPABASE_SECRET_KEY` for the public-form part, and deleting it afterwards | Yes |
| 8 | The two protected conference ids (original and earlier temporary conference): set `NEXT_PUBLIC_CONFERENCE_ID` and `PROTECTED_CONFERENCE_IDS`; confirm they will not be edited during the window | Recorded in the run sheet |
| 9 | Anonymous sign-in rate limit value to expect (default 30/hour/IP), and the network the run is made from | Cloud container / office |
| 10 | Whether an independent reviewer (Codex) reviews the run report and the stop-condition decisions | Yes |
| 11 | **H4 (optional):** whether people close votes in the temporary conference, who they are, and how they obtain staff access to it (no script provides that; it needs the bootstrap procedure for the temporary conference) | Decline unless the owner names the people and the access method; W3 then stays unverified |

Record the approval (who, when, scope) in [VERIFICATION.md](VERIFICATION.md) before the run.

## Hosted run procedure (after approval only)

1. **H0 checks** ([section 3](#isolation-checks-the-operator-performs)); record the baseline fingerprint, Advisors, and the dashboard plan/compute/PITR screenshot.
2. Create the pool: `npm run rehearsal:identities -- --chairs 19` (one day before; refuses non-allow-listed projects; paced; no secrets printed). The same 22 identities serve both fixtures.
3. Create fixture A: `npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 19 --delegates 420 --grant-hours 3`. It writes `fixture.json`, `identities.json`, `fixture.sql` and **`cleanup.sql`** under `.test-sessions/fixtures/<conference>/`. Apply `fixture.sql` (SQL editor, owner-approved).
4. Measure payloads: `npx tsx scripts/rehearsal-snapshots.mts --identities <A>/identities.json --fixture <A>/fixture.json --all-chairs`.
5. Run S0, then R1, R2, R3 as single-stage invocations with the go/no-go and two-minute settle of section 4.
6. Create fixture B with `--grant-hours 4`, apply its `fixture.sql`, and create one submission link for the committee passed as `--submit-committee` on the Preview (Executive -> Submission links); note the token without writing it into the run sheet.
7. Run H3 (confirm the printed plan says 150 page loads and 16 submissions), then H4 if approved, then observe H5, watching the dashboards live against [section 7](#7-stop-conditions).
8. Save the harness reports (`.test-sessions/rehearsal-<time>.json`), Supabase screenshots/exports and Vercel logs for each window; copy the summary into [VERIFICATION.md](VERIFICATION.md), stating for each report its label and whether it counts toward the gate (only H3 can).
9. **Cleanup** (below), for fixtures A and B.

## 9. Cleanup and verification

Run immediately after the last phase, and at once after any stop (for every fixture created):

1. **Revoke temporary access:** apply `.test-sessions/fixtures/<conference>/cleanup.sql` (for the legacy `prepare-load.mts` fixture: `.test-sessions/load-cleanup.sql`). It revokes, **only for the fixture conference id**, every `user_access` grant, `submission_links`, `amendment_links` and `private.access_credentials`. It deletes nothing, because audit, receipts and procedure history are append-only and the labelled rows are removed at cutover. Verify: the query at the end of `cleanup.sql` returns 0.
2. **Credentials:** delete `.test-sessions/rehearsal/*.json`, `.test-sessions/fixtures/*` and `development.json` from the operator machine; the grants have already expired (3 h) or been revoked. Delete the anonymous test users in the dashboard (Authentication -> Users) if the owner wants them gone now; otherwise cutover step 2 covers them.
3. **Label / delete the data:** the temporary conference stays labelled `LOAD TEST · ...` with no active access. It is deleted with the other test data at cutover ([DEPLOYMENT.md](DEPLOYMENT.md#single-project-cutover) step 2). Do not delete rows by hand during the test window.
4. **Vercel:** delete the Preview deployment(s) used (DEPLOYMENT step 3). Remove any `VERCEL_AUTOMATION_BYPASS_SECRET` from shells.
5. **Verify the original conference is unchanged:** run the fingerprint query again; it must equal the H0 baseline exactly. Also confirm the original conference's two active credentials and active grants are as recorded, the migration ledger still has 26 rows, and Advisors show no new findings.
6. **Report:** run sheet with times, versions (commit SHA), compute tier, thresholds met or missed, stop events, and the cleanup verification. Review by the independent reviewer.

## 10. Local dry run (no hosted calls)

Everything here uses local files or an in-process PGlite database; none of it contacts Supabase, Vercel or any network service. (`load-test.mts` and `rehearsal-run.mts` cannot run locally by design: the target guard requires a hosted `https://<ref>.supabase.co` project from the allow-list.)

* **L1. Tests and types:** `npm run typecheck`, `npm run lint`, `npm test`. This includes the PGlite database tests, the snapshot tests, the fixture/guard/cleanup tests (`tests/rehearsal-multi-committee.test.ts`, `tests/rehearsal.test.ts`, `tests/target-guard.test.ts`) and the rehearsal RPC-count tests.
* **L2. Scenario math at the gate size:**

```bash
npm run rehearsal:plan -- --staff 110 --delegates 150 --committees 19 --minutes 30 \
  --read-ms 600,2500 --realtime topic-aware --submit-fraction 0.08
```

  The parameters match H3. It prints roles (77/11/11/11), 3,841 staff writes, the snapshot RPC estimate per read latency, and the delegate-form plan (150 page loads, **16 submissions**); confirm these against [section 1](#request-rates-implied-by-the-commands-in-section-4) before any approval. Repeat with `--staff 25|50|80 --minutes 5 --delegates 0` for the ramp rows.
* **L3. Fixture generation with placeholder identities** (writes only to the ignored `.test-sessions/`; the placeholder files contain random user ids and no tokens):

```bash
node -e '
const fs=require("fs"),c=require("crypto");fs.mkdirSync(".test-sessions/dryrun",{recursive:true,mode:0o700});
const names=[...Array.from({length:19},(_,i)=>"chair-"+String(i+1).padStart(2,"0")),"approval","admins","executive"];
for(const n of names)fs.writeFileSync(`.test-sessions/dryrun/${n}.json`,JSON.stringify({user:{id:c.randomUUID()}}),{mode:0o600});
const p=n=>({session:`.test-sessions/dryrun/${n}.json`});
fs.writeFileSync(".test-sessions/dryrun-identities.json",JSON.stringify({mode:"multi-committee",chairs:names.slice(0,19).map(p),approval:p("approval"),admins:p("admins"),executive:p("executive")}));'
npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/dryrun-identities.json --committees 19 --delegates 420 --grant-hours 3
```

  Inspect `fixture.sql` (19 committees, 19 Chair grants, 22 grants in total, no Auth or secret content) and `cleanup.sql` (every statement filtered by the one conference id). Delete `.test-sessions/` afterwards.
* **L4. Apply fixture and cleanup SQL to an in-memory database:** the test `fixture guard: ... cleanup SQL revokes only the fixture conference` applies every migration in PGlite, loads a fixture, runs `cleanup.sql`, and checks that all fixture grants are revoked, no rows were removed and another conference is untouched. For a 19-committee variant, copy that test and set `N=19`.
* **L5. Payload size at 19 committees:** the unloaded snapshot size per role can be estimated locally by loading a 19-committee fixture into PGlite and calling `conference_state_snapshot` as each role (pattern in `tests/state-snapshot.test.ts` and `tests/executive-snapshot.test.ts`). The hosted numbers still come from `rehearsal-snapshots.mts` (H0 step 5).
* **L6. Guard behaviour:** confirm refusals with no network: `STAGING_SUPABASE_REFS= npx tsx scripts/rehearsal-identities.mts` refuses before contacting anything when `.env.local` is missing or the ref is not allow-listed; `tests/target-guard.test.ts` covers the production and PHESMUN refusals.

## 11. Script review: defects found and fixed

Reviewed: `scripts/load-test.mts`, `prepare-load.mts`, `prepare-session.mts`, `rehearsal-*.mts`, `scripts/rehearsal/*`, `lib/platform/target-guard.ts`, `package.json`.

Fixed in this change (tooling only, no product code):

| Defect | Fix | Test |
| --- | --- | --- |
| `load-test.mts`, `rehearsal-run.mts` and `rehearsal-snapshots.mts` trusted whatever conference id the fixture file held; a wrong file could aim a write load at the configured conference | New `checkFixtureConference` guard (well-formed UUID, not `NEXT_PUBLIC_CONFERENCE_ID`), called before any request | `tests/rehearsal-multi-committee.test.ts` |
| `load-test.mts` overwrote the committed historical `docs/load-test-results.json` on every run | Results now go to ignored `.test-sessions/load-test-results-<time>.json` | n/a (path change) |
| No cleanup artefact existed: neither fixture generator produced a way to revoke the temporary grants and links | `cleanupSql()` (revoke-only, filtered by conference id) written as `cleanup.sql` by `rehearsal-fixture.mts` and `load-cleanup.sql` by `prepare-load.mts` | PGlite test applies it and checks isolation |
| `rehearsal-run.mts` requested the deployment's `/api/health` (which can touch the database, Auth and Storage) before the local project and fixture guards | Project and fixture guards now run first; the first request is `/api/health` | `tests/load-guard-no-network.test.ts` (fetch, sockets and DNS blocked: zero attempts on every refusal; positive control reaches `/api/health` only for a valid fixture) |
| The first fixture guard accepted any valid UUID when `NEXT_PUBLIC_CONFERENCE_ID` was missing, blank or malformed, so it could not show the fixture differed from the protected conference | Fails closed on a missing, blank or malformed protected id; optional `PROTECTED_CONFERENCE_IDS` registry (malformed entry refuses) | `tests/rehearsal-multi-committee.test.ts` and the child-process test |
| `rehearsal-run.mts` labelled a 110-staff run "OPTIONAL STRESS / HEADROOM (100 staff)" and a 50-staff run "REQUIRED capacity gate" (the historical gate) | `capacityGateLabel()`: 110 or more is the current gate size, 100-109 optional stress, 50-99 "BELOW the current 110-device gate", under 50 smoke | `tests/rehearsal-multi-committee.test.ts` |
| `prepare-load.mts` hard-coded the venue `Development only` and date `2026-10-05` | Venue `TEST DATA - temporary, not a real conference`, date `current_date` | n/a |

Noted, not changed (would be feature work during the freeze or needs owner input):

* The harness has no vote-closing action, so W3 is a manual, optional scenario.
* `--stages` auto-escalates with no per-stage go/no-go or settle and evaluates once at the end; a single under-covered stage (25 staff covers 16 of 19 committees) makes the whole report `NOT A READINESS RUN`. The plan therefore uses single-stage invocations with a manual go/no-go (section 4). A wrapper that stops between stages would need separate review and was not added.
* Delegate traffic always starts with the stage (page loads in the first `--delegate-window` seconds); there is no option for a delayed burst.
* The runner's checks are the six in `evaluate()` plus the distribution check; page p95, 5xx logs, CPU, connections and every stop condition are manual.
* `--minutes` has no upper bound and the runner has no automatic abort; Ctrl-C discards in-memory outboxes.
* `load-test.mts` has a default of 150 clients and shares one identity; it is excluded from the hosted plan.
* `target-guard` protects the project, not the conference; the conference-level protection is the new fixture check plus RLS, and it knows only `NEXT_PUBLIC_CONFERENCE_ID` and the optional `PROTECTED_CONFERENCE_IDS` (the earlier temporary conference must be listed there by hand).
* The harness models a 60 s recovery poll; production polls every 120 s when Realtime is connected, so the harness read load is conservative.
* Percentiles of `apply_conference_mutation` on the server cannot be derived from `pg_stat_statements`; use client percentiles plus API logs.
