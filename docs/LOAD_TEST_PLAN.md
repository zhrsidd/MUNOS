# Conference-scale load test plan

Status: **PROPOSED, NOT APPROVED.** Written 21 October 2026 for the 5-7 November conference. Nothing in this document has been run against a hosted project. **The hosted load test MUST NOT run until the owner approves scope and timing** ([Owner approval](#owner-approval-required-before-any-hosted-run)).

This plan sits on top of the existing harness and does not replace [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md), which stays the source for phases A-F, the harness description and the historical measurements. This document adds: the derived conference model, an explicit test-data isolation design, ramp and sustained phases with request rates, the metrics to capture, hard stop conditions, cleanup, the Micro versus Small comparison, and a local dry run.

Related: [DEPLOYMENT.md](DEPLOYMENT.md) (target guard, single-project cutover), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (project state), [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) (conference-week gate), [RELIABILITY.md](RELIABILITY.md), [PT409_FIX_REPORT.md](PT409_FIX_REPORT.md).

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

### Request rates implied by the dry run

`npm run rehearsal:plan -- --staff 110 --delegates 150 --committees 19 --minutes 10` (local, deterministic, verified 21 October):

| Quantity | Value |
| --- | --- |
| Roles | 77 Chair, 11 Approval, 11 Admins, 11 Executive, 150 delegates |
| Staff writes | 1,528 in 10 minutes = **153 per minute (about 2.5 per second)**; no person faster than every 3 s, at most 3 writes per user per minute |
| Of which | 807 attendance, 376 queue adds, 72 speech starts, 62 scores, 59 speech finishes, 35 approvals, 17 prints, 12 sends to Approval, 53 photo acknowledgements |
| Snapshot RPCs (topic-aware Realtime, 600 ms read) | about **9,995 in 10 minutes = about 1,000 per minute (16.7 per second)**; 6.6 per write; 1,839 triggers dropped because the device was busy |
| By role | Chair 5,788, Executive 2,832 (with the 2 s Chair window; 5,156 without), Approval 692, Admins 682 |
| Public form | 150 page loads, 0 auth sessions; 44 submissions at the default fraction 0.3 (**too many for one link**: use `--submit-fraction 0.10`, about 11) |

Refreshes, not writes, dominate: this is why the pass criteria watch snapshot read latency and API connection use first.

## 2. Simulated workloads

| # | Workload | Real-world trigger | How it is simulated | Coverage |
| --- | --- | --- | --- | --- |
| W1 | **Roll call burst** | Session opens; every Chair marks about 22 delegates | Harness `attendance` steps (807 per 10 min), starts inside the 150 s start window. Worst realistic case: 19 Chairs x one write per 3 s = about 6.3 writes per second for about 66 s | Harness (human-paced). A faster-than-3 s burst is deliberately not modelled |
| W2 | **Speaker queue and score writes** | Debate | `queueAdd`, `speechStart`, `speechScore`, `speechFinish`, POIs; one floor device per committee | Harness |
| W3 | **Votes closing simultaneously across committees** | The Chair of every committee closes a vote at the end of a session | **Not in the harness** (no vote action). Run as a **people-driven scenario** in Phase B style: 19 Chairs (or fewer real people plus the harness already running in the background) each close one vote within a 10 s window, then repeat 3 times. Expect 19 `apply_conference_mutation` calls in about 10 s plus a refresh wave on Approval/Admins/Executive devices | **Gap**, manual. See [Owner decisions](#owner-approval-required-before-any-hosted-run): who performs it. Do not add harness features during the freeze |
| W4 | **Approval / Logistics polling** | Panels left open all day | 11 Approval + 11 Admins devices: focus returns every 30-90 s, recovery poll, topic-aware (ignore `chair` events), occasional approve/print | Harness |
| W5 | **Public submission burst** | "Submissions open" announcement | `--delegates 150` (or 200), `--delegate-window 120`, `--submit-token <token> --submit-committee <code> --submit-fraction 0.10`: page loads plus about 11-16 real submissions on one link | Harness |
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
3. **Fixture-conference guard (added with this plan).** `checkFixtureConference` is called by `load-test.mts`, `rehearsal-run.mts` and `rehearsal-snapshots.mts` before any request: the fixture must name a well-formed conference UUID that is **not** the configured `NEXT_PUBLIC_CONFERENCE_ID`. Before this change a mistaken fixture file could point the harness at the configured conference.
4. **Database scoping.** The fixture SQL creates the conference, committees, one session each, delegations, a scoring definition, and `user_access` grants **only for that conference id** with `expires_at = now() + grant-hours` (default 3, max 12). RLS and the `apply_conference_mutation` role checks mean an identity with no grant on another conference cannot write to it. Fixture ids are derived from the conference id.
5. **Labelled data.** `LOAD TEST` in the conference name, `Load test <code>` committees, `Simulated delegate N` / `loadN@example.com`, so the cutover cleanup ([DEPLOYMENT.md](DEPLOYMENT.md#single-project-cutover) step 2) finds everything by label.

### Residual risks (honest list)

* **Shared instance.** The temporary conference shares CPU, memory, connection pool and Realtime with the original test conference. This is acceptable only because **no real conference data exists in the project yet**. The window closes at the real Executive bootstrap ([FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md)). After real data exists, the project must not be load tested at all; at cutover the ref moves to `EXPECTED_SUPABASE_REF` and the tools refuse it.
* **Preview server routes.** The public-form part runs through a Vercel **Preview** whose `SUPABASE_SECRET_KEY` points at the same project. The submission link used must belong to the fixture committee (created by the fixture Executive identity). Old Previews must be deleted at cutover (DEPLOYMENT step 3), including those used for this test.
* **The fixture guard knows one conference id** (`NEXT_PUBLIC_CONFERENCE_ID`). The id of the earlier temporary conference is not in any variable; the operator records both ids in the run sheet and checks them by hand (step H0).
* **Credentials.** Pool identities are anonymous users created for the test (`rehearsal-identities.mts`: paced, capped at 25 sign-ins per run, below the 30 per IP per hour default). Their session files live in the ignored `.test-sessions/` (mode 0600) and are never printed or committed. One operator holds them at a time (refresh tokens rotate). The service/secret key is never given to the load scripts.

### Isolation checks the operator performs

* H0 (before): `.env.local` ref is `kllhswucdhqqywnzxado`; `STAGING_SUPABASE_REFS` lists exactly that ref; `EXPECTED_SUPABASE_REF` is **unset** in the operator shell; the fixture conference id differs from both recorded ids.
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

## 4. Phases, durations and request rates

All hosted phases run on **Small compute** (see [section 8](#8-micro-versus-small-compute)). Every performance run uses a **fresh fixture** (a reused one accumulates history and inflates snapshots). The 110-device figure and 19 committees are the release gate; lower stages are ramp steps.

| Phase | Duration | Load | Purpose | Command sketch |
| --- | --- | --- | --- | --- |
| **L0 Local dry run** | 30 min, no hosted calls | none | Validate scripts, fixtures, scenario math, SQL, tests | [section 10](#10-local-dry-run-no-hosted-calls) |
| **H1 Smoke** | 10 min | 10 staff, 0 delegates; about 15 writes/min, about 100 snapshot RPC/min | Prove guards, identities, grants, Realtime path, metrics capture | `npm run rehearsal:run -- --app <preview> --identities <f>/identities.json --fixture <f>/fixture.json --staff 10 --minutes 5` |
| **H2 Ramp** | 4 stages x 5 min + 2 min settle between = about 28 min | 25 -> 50 -> 80 -> 110 staff over 19 committees; writes about 35 -> 70 -> 110 -> 153 per min; snapshot RPC about 230 -> 450 -> 720 -> 1,000 per min | Find the knee before the gate; advance only if the previous stage meets [thresholds](#6-passfail-thresholds) | `--stages 25,50,80,110 --minutes 5` on a fresh fixture |
| **H3 Sustained (gate)** | 30 min | 110 staff / 19 committees steady (about 153 writes per min, about 1,000 snapshot RPC per min) **plus** the delegate burst at minute 10: 150 page loads in 120 s (about 1.25 per s) and about 11 submissions on one link | The C2 capacity gate; sustained behaviour, memory/IO drift, pool recovery | `--staff 110 --delegates 150 --delegate-window 120 --submit-token <t> --submit-committee <code> --submit-fraction 0.10 --minutes 30 --realtime topic-aware` on a fresh fixture |
| **H4 Spike (people)** | 15 min | W3: 19 simultaneous vote closes x 3 rounds, while the harness runs 50 staff in the background | Burst of `apply_conference_mutation` on distinct committee rows plus the refresh wave | Manual, with Chairs/volunteers; harness `--staff 50 --minutes 15` |
| **H5 Recovery** | 10 min | Stop load; watch | Connections idle, CPU and IO back to baseline, outbox drained, no 40001 loops | Dashboard only |
| **H6 Optional headroom** | 10 min | 150 staff | Information only; not a release requirement ([STAGING_REHEARSAL.md](STAGING_REHEARSAL.md)) | Only with explicit owner approval |

Delegate-form and fresh-sign-in (Phase D) tests stay as defined in [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md); the fresh-sign-in test is the only one that approaches the Auth rate limit and is run last and separately, with the limit value recorded first.

Total hosted time: about 2 hours of load plus setup and cleanup. Do not run H2/H3 back to back on the same fixture.

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
| **Auth rate limits** | Auth logs: anonymous sign-ins, token refresh, `over_request_rate_limit` | Expect near-zero during H1-H5 (pool identities pre-created) |
| **Realtime** | Realtime logs and Observability (connections, messages) | 110 devices is far below documented plan limits; still record |
| **Vercel** | Logs/Functions: 5xx, duration of `/api/*`, `/submit/*`, `/api/health`; function concurrency and timeouts | Region `bom1` ([vercel.json](../vercel.json)); read the team's current limits in the dashboard |
| **Real devices** | One real Chair browser kept open; System health page | Subjective responsiveness |

## 6. Pass/fail thresholds

Starting points, inherited from [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) readiness criteria. Record actuals; adjust only with the owner and an independent reviewer.

| Metric (H3 sustained gate, 110 staff / 19 committees) | PASS |
| --- | --- |
| Run label | `READINESS RUN` (one Chair identity per committee, Chair traffic in all 19) |
| Staff error rate (conflicts excluded) | < 1 % |
| Write p95 (aggregate; also report worst per-action) | <= 1.5 s |
| Read (snapshot) p95 | <= 2.5 s |
| Write/read p99 | recorded; no hard limit, but > 10 s is a WARNING that needs explanation |
| Public page p95 | <= 2 s, no 5xx; planned submissions (<= 18) all succeed; zero Auth activity from delegates; zero 429 |
| Unexplained 5xx, `PGRST003`, `40001`, `57014` | **0** |
| Duplicate / lost writes | **0** |
| PT409 conflicts | reported; each explainable by concurrent roll call; none lost |
| Postgres CPU | sustained average < 70 % in H3, no 5-minute window above 85 % |
| Connections | peak < 75 % of the plan limit; all idle after H5 |
| Memory | no sustained growth over H3; no swap thrash |
| Disk IO | no IO-budget depletion; IOPS/bandwidth not pinned at baseline during H3 |
| Recovery (H5) | outbox drained and connections idle within 5 minutes of stop |
| Isolation | original-conference fingerprint identical; no write outside the fixture conference |

The historical harness verdict takes the worst *per-action* p95, which for 12-13 sample actions is their single slowest request; read both the aggregate and the per-action number before declaring FAIL.

## 7. Stop conditions

**Whoever is on call stops the run immediately (Ctrl-C the harness, then apply `cleanup.sql`) on any of:**

1. **Any write to a real or original conference** (fingerprint difference, or a `conference_id` in API logs other than the fixture). Stop, do not resume, notify the owner, run the isolation checks.
2. **Error rate**: > 2 % real failures in any 60 s window, or > 1 % over 5 minutes (conflicts excluded).
3. **Latency**: write p95 > 5 s or read p95 > 8 s for 3 consecutive minutes; any single request > 30 s.
4. **Postgres CPU** > 90 % for 2 consecutive minutes.
5. **Connection saturation**: any `PGRST003`; database connections > 85 % of the limit; pool fully busy for more than 60 s.
6. **Memory** > 90 % or swap growing; **disk IO budget** depleted or IOPS pinned.
7. **Statement timeout** (`57014`) twice in a window, any `40001`, or any 5xx burst (>= 3 in 60 s).
8. **Auth rate limiting**: any 429 or `over_request_rate_limit` from Auth during H1-H5 (the pool is pre-created; a sign-in attempt means something is wrong). Do not loop retries.
9. **PostgREST rate limiting** or any 429 on staff routes; **public form** 429 (means the plan exceeded the per-link limit).
10. Target guard or health check reports `production`, or the wrong project ref appears anywhere.
11. Anything unexpected on the **real** Supabase or Vercel production surface (alerts, deployments).
12. The owner or the person in charge says stop.

After a stop, do not restart on the same fixture. Record the time, cause and last good metrics; the next attempt needs a new approval for the changed scope.

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
* **Recommendation (consistent with the existing setup doc and checklist): upgrade to Small before 5 November** ([SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md), [DEPLOYMENT.md](DEPLOYMENT.md)); [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) wants the gate at T-7 days, about 29 October. The previous guidance says load phases are not run on the smaller tier.
* **What to test on which:**
  * **Micro (current, only if the owner wants a baseline): L0 and H1 smoke only** (10 staff). No ramp, no gate. It confirms tooling and gives a before number. Optionally H2 capped at the 25-staff stage with explicit approval.
  * **Small: H1, H2, H3, H4, H5** (the full plan), then re-run only the failed phase after any fix.
  * A compute change restarts the database briefly; schedule it outside any run and re-baseline the original-conference fingerprint afterwards.

### Suggested timeline (owner decides)

| Date | Step |
| --- | --- |
| 21-23 Oct | Review this plan; run L0 locally; owner decisions below |
| 24-26 Oct | Confirm plan/compute/PITR in the dashboard; upgrade to Small; prepare identities (the day before; 22 pool identities take about 8 minutes at the 20 s pace) |
| 27-29 Oct | H1 smoke, then H2, H3, H4, H5 on one day with the on-call team; cleanup the same day |
| 30-31 Oct | Fix findings; repeat only the failed phase; release freeze |
| 1-4 Nov | No load tests. Remove test data per DEPLOYMENT cutover step 2 |

## Owner approval required before any hosted run

**Status: awaiting owner decision. No hosted request has been made.** The hosted load test must not run until the owner (Zuhayr Siddique) approves, in writing, each of the following. John Paul Ribeiru approves releases; Zuhayr Siddique is in charge during any live problem.

| # | Decision needed | Proposed default |
| --- | --- | --- |
| 1 | **Date and time window** (start/end, UTC and Qatar time), with the confirmation that the window ends before the real Executive bootstrap and before any real conference data enters the project | 27-29 October, one block of about 4 hours including setup and cleanup |
| 2 | **Size**: scope of phases (H1-H5 only, or also H6), maximum staff devices (110 gate), maximum delegates (150-200), submissions on one link (<= 18) | H1-H5, 110 staff, 150 delegates, 11 submissions |
| 3 | **Compute tier**: confirm plan and compute from the dashboard; approve upgrading to Small and the date; approve (or decline) a Micro smoke baseline | Upgrade to Small first; Micro only L0/H1 |
| 4 | **Delegate count** to use (420 assumed) | 420, sensitivity 570 if time |
| 5 | **Who is on call** with Supabase and Vercel dashboard access, who holds the harness, who watches logs, who can stop the run, and who performs the H4 vote closures (Chairs/volunteers) | Claude runs the harness; technical contact on the dashboards; Executive observes |
| 6 | Approval to apply the fixture SQL and cleanup SQL (a write to the staging project) and to create about 22 temporary anonymous identities | Yes, labelled, expiring in 3 hours |
| 7 | Approval to use a Vercel Preview (named commit) with `SUPABASE_SECRET_KEY` for the public-form part, and to delete it afterwards | Yes |
| 8 | The two protected conference ids (original and earlier temporary conference), and confirmation they will not be edited during the window | Recorded in the run sheet |
| 9 | Anonymous sign-in rate limit value to expect (default 30/hour/IP), and from which network the run is made | Cloud container / office; Phase D from the venue network, last |
| 10 | Whether an independent reviewer (Codex) reviews the run report and the stop-condition decisions | Yes |

Record the approval (who, when, scope) in [VERIFICATION.md](VERIFICATION.md) before the run.

## Hosted run procedure (after approval only)

1. **H0 checks** ([section 3](#isolation-checks-the-operator-performs)); record the baseline fingerprint, Advisors, and the dashboard plan/compute/PITR screenshot.
2. Create the pool: `npm run rehearsal:identities -- --chairs 19` (one day before; refuses non-allow-listed projects; paced; no secrets printed).
3. Create the fixture: `npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 19 --delegates 420 --grant-hours 3`. It writes `fixture.json`, `identities.json`, `fixture.sql` and **`cleanup.sql`** under `.test-sessions/fixtures/<conference>/`.
4. Apply `fixture.sql` to the staging project (SQL editor, owner-approved). Create one submission link for one fixture committee on the Preview (Executive -> Submission links).
5. Measure payloads: `npx tsx scripts/rehearsal-snapshots.mts --identities <f>/identities.json --fixture <f>/fixture.json --all-chairs`.
6. Run H1, then H2, H3, H4, H5, each on its fixture rule, watching the dashboards live against [section 7](#7-stop-conditions).
7. Save the harness report, Supabase screenshots/exports and Vercel logs for each window; copy the summary into [VERIFICATION.md](VERIFICATION.md).
8. **Cleanup** (below).

## 9. Cleanup and verification

Run immediately after the last phase, and at once after any stop:

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
npm run rehearsal:plan -- --staff 110 --delegates 150 --committees 19 --minutes 10 \
  --read-ms 600,7000 --realtime topic-aware --submit-fraction 0.10
```

  Prints roles, writes per minute, snapshot RPC estimates per Realtime model and read latency, and the delegate-form plan. Compare with [section 1](#request-rates-implied-by-the-dry-run).
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
| `prepare-load.mts` hard-coded the venue `Development only` and date `2026-10-05` | Venue `TEST DATA - temporary, not a real conference`, date `current_date` | n/a |

Noted, not changed (would be feature work during the freeze or needs owner input):

* The harness has no vote-closing action, so W3 is a manual scenario.
* `load-test.mts` has a default of 150 clients and shares one identity; it is excluded from the hosted plan.
* `target-guard` protects the project, not the conference; the conference-level protection is the new fixture check plus RLS, and only knows `NEXT_PUBLIC_CONFERENCE_ID`.
* The harness models a 60 s recovery poll; production polls every 120 s when Realtime is connected, so the harness read load is conservative.
* Percentiles of `apply_conference_mutation` on the server cannot be derived from `pg_stat_statements`; use client percentiles plus API logs.
