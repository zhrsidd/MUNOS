# Staging rehearsal plan

The technical performance and failure rehearsal. **Scheduled for conference week**, after the Supabase project is upgraded to Pro with Small compute (see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) → *Conference week*). Do **not** run the load phases (C, D) on the current development Nano instance: earlier runs there are kept below as evidence only. The non-load staff familiarisation rehearsal is a separate document: [STAFF_REHEARSAL.md](STAFF_REHEARSAL.md). Nothing here runs against production. Owner: Claude (platform), with the Executive and one Chair per tested committee.

Conference OS is **staff software**; delegates are not users. Two load populations are tested **separately**:

| Population | Who | Realistic peak | Rehearsal target (headroom) | Touches |
| --- | --- | --- | --- | --- |
| **Staff app** | Chairs, Approval, Admins, Executive | ≈ 45–55 active devices (e.g. 14 committees × 2–3 Chair laptops + ~4 Approval + ~4 Admins + ~3 Executive) | **50** simulated staff devices across the real committees (required gate); 100 only as an optional stress/headroom test | Supabase Auth session, snapshot reads, outbox writes, Realtime |
| **Delegate public form** (resolution QR) | Delegations on phones | ≈ 100–150 page loads within a couple of minutes after "submissions open"; a handful of submissions per committee link | **150–200** page loads over the delegate window + a safe number of real submissions on one link (≤ 18; the designed limit is 20 per link per 10 min) | resolution QR only (`/submit/{token}`, `POST /api/submissions`) — server-mediated, **no Supabase Auth session**. The amendment QR (`/amend/{token}`) is verified functionally (Phase A, E15, rate limits, link rotation), not by this synthetic burst. |

A 100-person conference is mostly delegates, who have no staff session: it does **not** mean 100 or 200 simultaneous staff users. The required capacity gate is therefore **realistic 50 staff across the real committees plus the delegate public-form traffic** (C2 below). Larger staff counts are optional stress tests only.

## Environments

| | Used for | Database |
| --- | --- | --- |
| **Vercel Preview** (any PR/branch) | Phases A–E | Development Supabase `opmydpozhdgkpcnjwpqb` |
| **Staging project** (optional second Vercel project, e.g. `munos-staging`, production branch `staging`) | Phase F rollback drill before Production exists — Instant Rollback only exists for a project's *production* deployments | Development Supabase |
| Production (built only from the `production` branch) | **Never** used for load or failure tests. The rollback drill may be repeated there once, before the freeze, with a harmless change | Production Supabase |

Previews have Vercel Authentication on; scripts use a *Protection Bypass for Automation* secret (`VERCEL_AUTOMATION_BYPASS_SECRET`, set only in the operator's shell).

## Preparation

1. The release candidate is a `main` commit; its automatic Preview uses development Supabase variables and `SUPABASE_SECRET_KEY` (dev).
2. All migrations applied to the **development** project exactly once (Codex-owned; through `20261008135032` at the time of writing).
3. `.env.local` points at the development project (the scripts refuse anything else).
4. **Rehearsal identities — one Chair identity per committee (required for readiness).** `npm run rehearsal:identities -- --chairs 14` (development project only; refuses anything else) prepares **14 Chair sessions — one per simulated real committee** — plus one each for Approval, Admins and Executive, under the git-ignored `.test-sessions/rehearsal/` (files mode 0600, tokens never printed), and writes the pool `.test-sessions/rehearsal-multi-identities.json`. Existing session files are refreshed, never replaced; new anonymous sign-ins are paced (one per 20 s) and capped at 25 per run, under Supabase's default 30 per IP per hour — run it the day before. It grants nothing. Sessions near expiry are refreshed before each run; only one operator may hold these sessions at a time (Supabase rotates refresh tokens). The harness grants these identities through the fixture SQL instead of redeeming staff access codes: code redemption is a one-off per device and is exercised by real people in Phase A/B and Phase D, not in the load loop.
5. **A fresh synthetic conference for every performance run** (a reused conference accumulates audit and procedure history and inflates every snapshot): `npx tsx scripts/rehearsal-fixture.mts --identities .test-sessions/rehearsal-multi-identities.json --committees 14` writes `.test-sessions/fixtures/<conference>/{fixture.json, identities.json, fixture.sql}` — **14 real committees, one normal session each, and 14 Chair grants: Chair identity k → committee k** (role `chair`, `committee_id` = committee k), plus one Approval, Admins and Executive grant, 420 delegations spread across the committees, clean state. It refuses to run with fewer distinct Chair identities than committees. The fixture conference has no central session slots, so the `materialize_central_sessions` trigger adds nothing when its committees are inserted. Apply `fixture.sql` to the **development** project, then pass `--fixture` and `--identities` from that folder. (Historical only: a single-Chair identities file with `--legacy-floors` reproduces the earlier one-committee "floor" fixture, and `scripts/prepare-load.mts` the all-roles worst case; both are labelled NOT A READINESS RUN.)
6. Optional: create a submission link for one rehearsal committee (Executive → Submission links on the Preview) and note its token.
7. Dry-run the scenario: `npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10` (prints the refresh estimate per Realtime model and assumed refresh latency).
8. Measure the starting payload per role: `npx tsx scripts/rehearsal-snapshots.mts --identities <folder>/identities.json --fixture <folder>/fixture.json` (measures the one bundled snapshot RPC each role's device sends; `--all-chairs` probes every committee's Chair, `--components` shows the bundle's parts).

## Phase A — Basic staging check (30 min)

- [ ] Preview URL opens; `npm run verify:deployment -- <preview-url> <commit>` passes.
- [ ] System health: GREEN, *Running version* = the Preview commit, environment `preview`, Supabase reachable, Storage `ok`.
- [ ] Each role on a separate browser, signed in **with a staff access code** (Executive → Access codes): Chair (two committees), Approval, Admins, Executive.
- [ ] Executive → Sessions: one central session exists and appears in every active committee; each Chair selects it as the current session.
- [ ] Google-Doc submission end to end: QR page → Delegate submissions → Open Google Doc → Submit to Approval → Approve → Print → In Debate.
- [ ] Amendment QR end to end: amendment page shows the resolution in debate → submit → Chair amendment inbox → Accepted for Debate → In Debate → Closed (Passed) → Chair edits the Google Doc by hand.
- [ ] Public form shows only committee, delegation selector, title, link, checkbox and fallback — no staff navigation; browser storage shows no Conference OS database and no Supabase session after submitting.
- [ ] Sharing matrix (see GOOGLE_WORKSPACE_ACCESS_MODEL.md §12): personal Gmail Doc on *Anyone with the link → Editor*; another school's Workspace Doc; a school account that blocks link sharing (direct share to a Chair, or file fallback); a Viewer-only link (Chair marks *Can't access*).
- [ ] Group-photo slot with a reminder 10 minutes out.
- [ ] Offline: on each staff role's prepared device, cut the network and reload that role's System health page (`/chair/health`, `/approval/health`, `/logistics/health`, `/admin/health`); it renders and **Export device recovery file** works.

## Phase B — Functional multi-user test (45 min, real people)

At least: 3 Chairs on 3 committees (one committee with **two** Chair laptops), 1 Approval, 1 Admins, 1 Executive, 5 phones as delegates.

Run a scripted mini-session: roll call, 10 speakers with queue advance, participation points, a POI point, two delegate submissions per committee, Chair → Approval → Print, one vote, a photo reminder, one schedule change. Record anything confusing or slow — usability findings matter as much as errors.

Verify: both laptops in the shared committee converge within a minute; conflicting edits produce a clear "review" message, not silent loss; Approval sees only Submitted+ resolutions.

## Phase C — Capacity (60 min)

**C1 — Staff warm-up (optional, recommended first):** `npm run rehearsal:run -- --app <preview-url> --identities <folder>/identities.json --fixture <folder>/fixture.json --stages 25 --minutes 5` on its own fresh fixture. With a multi-committee fixture, Chair devices of simulated committee k use **committee k's own committee row, session and Chair identity**; several Chair devices in one committee share that committee's identity. The run refuses to start if any committee lacks its own Chair identity.

**C2 — REQUIRED capacity gate: 50 staff + delegate public-form traffic (realistic peak):** on a fresh multi-committee fixture, `npm run rehearsal:run -- --app <preview-url> --identities <folder>/identities.json --fixture <folder>/fixture.json --staff 50 --delegates 150 --delegate-window 120 --submit-token <GA1 resolution-link token> --submit-committee GA1 --submit-fraction 0.10 --minutes 8`. This plans **150 page loads and 11 real resolution submissions** on the one link (deterministic scenario; 200 delegates would plan 16). Delegates use real delegation ids from `fixture.json` and create **no Supabase Auth session**. Before any request the run refuses if it would plan more than **18** submissions on a single link — the production limit is 20 accepted per link per 10 minutes and the capacity run must never cause an intentional 429. Rate-limit behaviour is tested separately (functional tests and Phase D/E), never in this run. Without `--identities` every device would share one all-roles identity: a historical worst case, never a readiness run.

**C3 — OPTIONAL stress / headroom test (NOT a release requirement):** the same command with `--staff 100` (plans 15 submissions at 0.10). Record the numbers for information; a weaker result here does not block the release if C2 passes.

The harness (`scripts/rehearsal-run.mts`) simulates **people, not requests**, in two populations:

| Simulated role | Share of staff | Behaviour |
| --- | --- | --- |
| Chair | 70% | one *floor* device per committee sets the Current session, adds to lane queues, starts speeches from the queue, scores, runs POIs, finishes; other Chair devices take roll call, add to queues and refocus |
| Approval | 10% | returns to the tab every 30–90 s (window focus); approves a Submitted resolution occasionally |
| Admins | 10% | returns to the tab; marks Approved as Printed |
| Executive | 10% | returns to the tab; `/api/health` |
| **Delegate** (separate `--delegates N`) | — | loads the public QR page once inside the delegate window; 30% submit a Google Doc link 30–180 s later (with `--submit-token`). **No Supabase client, no session, no staff navigation**; delegations are picked from the fixture file for `--submit-committee`. |

Safety and realism built in: staff open within a 2.5-minute window (burst); **no person acts faster than every 3 s**; 10% of staff writes are immediately re-sent with the same id (simulated lost response); defaults are 10 staff, 0 delegates, 5 minutes; maximum 200 per population; refuses custom domains, bare `*.vercel.app` aliases and any target whose `/api/health` reports `production`; the Supabase side is locked to the development project; **no override exists**.

`npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10` (dry run): ≈ 128 staff requests/min and ≈ 73 staff writes/min for 50 staff devices (≤ 2.1 writes per person per minute), plus 150 public page loads and ≈ 47 submissions with **0 auth sessions**. The 200-staff stage is four times that.

Observe during each stage: harness p50/p95/p99 per action; Supabase *Observability* (CPU, connections, API latency), *Logs* (API errors, 429s, Auth); Vercel *Logs/Functions* (5xx, duration for `/api/*`, `/submit/*`); one real Chair browser kept open — is it still responsive?

Results: `.test-sessions/rehearsal-<time>.json` (ignored; contains samples). Copy the summary into `docs/VERIFICATION.md` by hand.

### Client and Realtime model used by the harness

Reads are not scripted per action. Every simulated staff device runs `scripts/rehearsal/client-model.ts`, a line-for-line model of the production sync loop (`DurableRepository.flush()` in `lib/sync/repository.ts`):

- **One flush in flight per device.** A trigger that arrives while a flush runs is dropped — not queued, not replayed — exactly as production returns early when `flushing` is true.
- Triggers: opening the app; a write (`execute()`); a Realtime notification (350 ms trailing debounce, reset on each event); window focus; the recovery timer (60 s + jitter after every flush, exponential backoff after a failure).
- Flush body (core PR #9): send each outbox item, read the snapshot back, remove the item; a separate final refresh runs only when nothing was read back (empty-outbox recovery/poll) or a conflict still blocks the outbox. A write recorded during an empty-outbox refresh waits for the next trigger, as in production. Failed sends/refreshes keep the item and re-send the same mutation id.
- Human assumption (not client behaviour): a conflicting item is dismissed by the Chair before their next action.

Executive/Admin-only devices mirror core PR #10: a `chair` event starts a fixed 2 s window (later Chair events never extend it; one refresh at expiry); any other topic cancels a pending window and uses the 350 ms debounce, and Chair events arriving while that debounce is pending add nothing (`--executive-chair-window 2000`, default; `0` reproduces earlier core). The harness uses the production `SupabaseTransport` and passes each device's granted roles to it, as production does, so the Executive identity reads `executive_state_snapshot` and every other role `conference_state_snapshot`; the snapshot probe measures the same function per role.

**Not modelled by the load loop** (exercised by people in Phases A, B and E instead): access-code redemption, central-session edits, amendment QR submissions and the amendment lifecycle, committee/session archive. Their server cost is small relative to snapshot reads; the amendment data rides inside the same bundled snapshot (`staff_batch_snapshot`, bounded to 200 current amendments).

Realtime is simulated from the server's real `operational_changes` topics (see `TOPIC_OF` in `scripts/rehearsal/scenario.ts`: procedure, roll-call and photo writes → `chair`; document workflow → `documents`; timer → no event). `--realtime topic-aware` (default; the core read-path change): Chairs refresh for their own committee, Approval and Admins ignore `chair`, Executive keeps all topics. `--realtime current` reproduces `main` before that change (every non-Chair role refreshes on every write).

The report separates triggers attempted, triggers dropped because the device was busy, refreshes executed (by role and by source: open, post-write reconciliation, Realtime, periodic recovery, refocus), reads per write and snapshot RPC calls **as actually sent** (`scripts/rehearsal/rpc-counter.ts` wraps each device's Supabase client): on core with the bundled read path (PR #11, migration `20261006211039`) that is **one** `conference_state_snapshot` / `executive_state_snapshot` RPC per logical refresh; two (core snapshot + `operations_snapshot`) appear only if the PGRST202/42883 fallback is really used, and `snapshotRpcsByName` in each stage shows which functions ran. The dry-run estimator uses 1 per refresh. Results recorded below before PR #11 were on two-RPC core (2 per refresh), and the first Preview 50-staff report on PR #11 printed `3440` from the old `reads × 2` formula — the measured count was 1,720 (1.00 per refresh, confirmed in `pg_stat_statements`).

**Why the capacity gate needs one Chair identity per committee.** The earlier fixture gave one Chair identity a grant for **one** real committee and simulated the 14 committees as "floors" (extra sessions inside it). Every committee-scoped mutation takes `select … from public.committees where id = … for update` (see `apply_mutation` / `apply_procedure`), so **all Chair writes from all floors serialized on the same `committees` row** — contention a real conference never has, because each committee has its own row and Chairs in different committees never wait on each other. Those runs therefore **overstated shared-row lock waits and the write-latency tail** (read cost and RPC counts were not affected). The single-committee fixture is kept only for historical comparison with the results below. **The final 50-staff capacity gate MUST use one distinct Chair rehearsal identity/grant scope per simulated real committee** (realistic multi-committee mode). Every run report states `identityMode`, the number of actual committees with Chair traffic, distinct Chair identities, Chair devices and the committee → Chair identity mapping, and labels itself `READINESS RUN` or `NOT A READINESS RUN`. The verdict can only PASS for a readiness run: legacy-floor, all-roles or under-covered runs report metrics but always fail the readiness check.

## Phase D — Burst start and shared NAT (45 min)

**Why it matters.** At the venue most devices share one public IP. A staff device gets its identity when someone types a **staff access code**: the gate reuses an existing session or creates **one** anonymous Supabase identity, then redeems the code (`redeem_access_code`). Opening the app without submitting a code creates nothing. Supabase limits **anonymous sign-ins per IP per hour** (default 30 — check the project's Auth rate-limit settings); token refreshes have their own per-IP limit, and code redemption has its own attempt limit. **Delegates on either QR page do not sign in**: `/submit/*` and `/amend/*` skip the staff provider and device storage, and their POST routes are served by the server with the server-only secret key. A delegate burst is therefore **not** an anonymous sign-in burst; shared-NAT auth risk is about **fresh staff devices entering codes at the same time**.

Test from **one network** (ideally the school Wi-Fi; otherwise one office connection):
1. **Prepared devices:** 30–60 browser profiles that already have sessions and grants (as on conference morning). Open all within 2–3 minutes. Expect: all reach GREEN; only token refreshes, no sign-ups.
2. **Fresh devices entering codes:** open N new browser profiles within 2–3 minutes (Playwright contexts or real laptops), N = 10, 25, 40, and enter a valid staff access code on each. Record how many obtain a session and a grant, Auth log entries, HTTP 429s / rate-limit messages, and what a failed device shows (the access gate with a clear message — never a silently local workspace).
3. **Delegate burst from one network (separate test):** 150–200 QR page loads within 2 minutes from the same public IP (`--staff 1 --delegates 200 --submit-token … --submit-fraction 0.05`, or real phones on the school Wi-Fi). Expect: no auth activity at all in Supabase Auth logs; page p95 ≤ 2 s; submissions succeed; Vercel function errors 0. This plans 200 page loads and 6 submissions; real submissions on one link stay ≤ 18 (the harness refuses more); an explicit rate-limit check — submitting past 20 on one link and seeing the clear "Too many submissions" response — is a separate, deliberate functional test, not a capacity result.

Do **not** weaken security to pass: no blanket anonymous policies, no trusting client-supplied IPs. If fresh sign-ups hit the limit, the plan stands: prepare all staff devices in advance (the day before), stagger code entry, and set a measured Auth rate limit. The access-code design (PR #12/#13) already gives each device one stable identity, creates none per navigation or refresh, and handles replacement laptops by entering a code on the new device; this phase measures it against the per-IP limits from a single NAT.

## Phase E — Failure injection (60 min)

Run with 25–50 simulated staff devices in the background and real people on the devices below.

| # | Inject | Expected |
| --- | --- | --- |
| E1 | Chair laptop Wi-Fi off 10 min while recording roll call, speakers, participation | YELLOW "Internet unavailable — N changes saved on this device"; RED reminder after 15 min; on reconnect all sync once (see offline test) |
| E2 | Block Realtime only (DevTools: block `*/realtime/v1/*`, or firewall the websocket) | YELLOW "Live updates temporarily unavailable"; actions still save; other devices see changes within ~60 s or on refocus; on unblock, reconnect triggers an immediate refetch |
| E3 | Storage unavailable (rename the bucket on dev, or remove `SUPABASE_SECRET_KEY` storage access on the Preview) | Health YELLOW "Document storage…"; Google Doc submissions still work; file upload returns "NOT submitted" and creates nothing |
| E4 | `/api/health` unavailable (block the route in DevTools) | Health shows "Conference OS service not responding"; everything else unaffected |
| E5 | Google Docs unreachable on a Chair laptop (block `docs.google.com`) | Conference OS fully usable; *Open Google Doc* fails in Google's tab only |
| E6 | Chair refreshes mid-debate (timer running, queue populated) | State restored from device storage; timer continues from its stored start; no duplicate entries |
| E7 | Double-click / repeated retries (rapid clicks, harness retries) | Exactly one record per action |
| E8 | Second Chair opens the same committee and edits the same delegate's attendance | One succeeds, the other shows a conflict to review; nothing silently overwritten |
| E9 | Chair laptop "disappears" (close lid with unsynced changes, take a spare) | Spare shows only synced work; recovery procedure from the runbook works (export before reconnecting) |
| E10 | Browser closed and reopened (online and offline) | Reopens to the same committee; offline reopen works within the 48-hour lease |
| E11 | Supabase unreachable for the Preview (temporarily wrong URL on a test device, or network block) | Health YELLOW "database unreachable"; device keeps saving; QR submissions show "NOT submitted" |
| E12 | Photo reminder while offline / after refresh / device time zone changed | Reminder appears on time from cached data; wrong *clock* shifts it (documented) |
| E13 | Chair offline records attendance; meanwhile the Executive archives that central session | On reconnect the change returns `PT409` and shows "needs review" (kept, not lost); export → keep conference value |
| E14 | Executive revokes a Chair's access code **with** device revocation while the Chair has unsynced work | Device loses access; pending work is retained; sign-out is refused until a recovery export is downloaded; the export contains the pending changes |
| E15 | Executive rotates the amendment link while a delegate has the old QR open | Old link → "not valid"; new printed sheet works; no duplicate amendment from a retried submit |

## Offline / reconnect rehearsal (exact steps)

1. Chair opens the committee online (status GREEN).
2. Disconnect the network.
3. Change attendance for three delegates.
4. Add two speakers; advance the queue once.
5. Log two participation points (one Speech, one POI).
6. Check the UI: status strip "Internet unavailable — N changes saved on this device"; System health shows the same N unsynced.
7. Refresh the page while still offline: the Chair Console reopens with the changes.
8. Reconnect.
9. Within ~1 minute: status GREEN, 0 unsynced.
10. On a **second device**: attendance, queue and participation match exactly; participation count increased by exactly 2 (no duplicates).
11. Idempotency check: repeat with the network dropping **during** a sync (toggle off right after reconnect) — still exactly one record per action.
12. Conflict check: while device A is offline, device B changes the same delegate's attendance; reconnect A → A shows "need review"; export, keep the conference value, confirm nothing else was lost.

## Realtime

Realtime is an enhancement. Verify: available (changes appear within ~1 s), disconnected (E2: ≤ 60 s via recovery reads, immediately on refocus), reconnecting (refetch on resubscribe). Core actions never wait for Realtime. `npm run test:load` additionally measures Realtime connect/reconnect for up to 200 channels.

## Drive rehearsal — FUTURE (design only)

Run when the Drive integration exists ([GOOGLE_DRIVE_ARCHITECTURE.md](GOOGLE_DRIVE_ARCHITECTURE.md)):
committee-folder setup twice (no duplicates) · Submit to Approval creates exactly one copy in the right committee folder · retry after a forced timeout adopts the existing copy · Drive unavailable → Conference OS unaffected, status "Failed — will retry" → recovers automatically · permission error (Doc not shared with the Group) → "Needs attention" with a plain reason · PDF snapshot re-run updates, not duplicates.

## Phase F — Rollback drill (30 min, staging project only)

1. On `munos-staging`, record the current production deployment as "known-good (staging)".
2. Deploy a harmless but visible change (e.g. version string) as the new staging production.
3. "Discover" the issue: System health shows the new version.
4. Instant Rollback to the known-good deployment (Vercel → Deployments → ⋯ → Instant Rollback).
5. Verify: `npm run verify:deployment -- <staging-url> <known-good-commit>`; System health shows the known-good version; a Chair device with unsynced changes keeps them and syncs after refresh; conference data unchanged.
6. Time it. Target: under 5 minutes from decision to verified.
7. Undo the rollback state afterwards so staging auto-deploys again.

## Metrics

| Metric | Source |
| --- | --- |
| Success / failure rate, conflicts, rate-limited responses | Harness report |
| p50 / p95 / p99 per action (reads, each write type, page loads, health, submission) | Harness report |
| Database latency, CPU, connections | Supabase Observability; System health *Database latency* on real devices |
| Supabase API / Auth errors, 429s | Supabase Logs |
| Duplicate / lost writes | Harness exactly-once check; manual counts in the offline test |
| Unsynced operations, conflicts | System health on real devices |
| Realtime disconnect / recovery | Status strip; `npm run test:load` |
| Serverless errors and duration | Vercel Logs / Functions |
| Browser-visible failures | Observers on real devices (screenshots + time) |

No extra monitoring platform is needed for this.

## Readiness criteria

**REQUIRED capacity gate (C2, conference week, Supabase Pro + Small) — PASS only if all are true:**
- **Realistic multi-committee mode:** the harness report says `READINESS RUN` — 50 simulated staff, one distinct Chair identity/grant per simulated real committee, Chair traffic in every committee, no identity shared across committees.
- Delegate public-form traffic: 150–200 resolution page loads over the delegate window with page p95 ≤ 2 s and no 5xx; the planned real submissions (≤ 18 on the one link) all succeed; **zero Supabase Auth activity** from delegates; **no rate-limit responses** (the plan stays below the designed limit).
- Staff app: error rate < 1% (conflicts excluded), write p95 ≤ 1.5 s, read p95 ≤ 2.5 s; real Chair browsers stay responsive.
- Zero unexplained HTTP 5xx, zero `PGRST003` (connection-pool wait) errors, zero `40001` retry loops, zero statement timeouts in Supabase/Vercel logs for the run window.
- Zero duplicate and zero lost writes (harness exactly-once check, plus offline/reconnect).

**Also required before release (functional, not load):**
- Amendment QR end to end, its rate limits, link rotation and public access (Phase A, E15); the synthetic burst does not load-test `/amend/*`.
- Burst start of prepared devices: all reach GREEN within 3 minutes.
- Realtime loss never stops core operations.
- Rollback completed and verified in under 5 minutes.
- No critical security/RLS findings (Supabase Advisors: no new findings beyond the accepted list in RELEASE_CHECKLIST.md; no anonymous grants).

**OPTIONAL stress / headroom (information only, NOT a release requirement):** C3 at 100 staff — record latency and errors; look for systemic failure (cascading errors, stuck devices). Do not run 150–200 staff: that traffic is not expected at this conference.

**FAIL (any):** sign-in/auth burst breaks prepared devices · duplicated queue/participation entries · offline changes disappear · database latency makes chairing impractical (several seconds per action) · any Drive or Google dependency blocks core workflow · rollback cannot be completed confidently.

Thresholds are starting points from the current architecture; record actual numbers and adjust with Codex if the data says otherwise. The earlier single-identity burst test (`docs/load-test-results.json`) showed high burst read latency, so read p95 under burst is the number to watch first.

## Measured results so far — 6 October 2026 (local production build → development Supabase)

> All results in this section used the **legacy single-committee** fixture (or the all-roles worst case) and are **NOT READINESS RUNS**; their write tails overstate shared-row contention. They are kept for historical comparison only.

Not a Preview: the harness ran in one Node process in a cloud container (~250 ms round trip to `ap-south-1`) against a local `next start` used only for the health guard. **All runs below used the earlier harness, which let one simulated device run overlapping full refreshes** (the Realtime debounce flag cleared before its read finished, and scripted reads ignored an in-flight refresh). They therefore overstate client concurrency once refreshes become slow; they are kept as evidence, not as a baseline.

| Run | Identity / fixture | Writes | Full refreshes | Reads/write | Read p50 / p95 | Write p50 / p95 | Errors | Duplicates / lost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 staff | WORST CASE: one all-roles identity; reused fixture | 234 | 2,377 | 10.2 | 1.3 / 4.1 s | 0.5 / 2.4 s | 0 | 0 / 0 |
| 50 staff | WORST CASE; reused fixture | 390 | 3,310 | 8.5 | ≈ 25 / 93 s | ≈ 13 / 86 s | 52% (40001 retry loops, below) | 0 / 0 |
| 25 staff | role-scoped; reused fixture | 221 | 2,184 | 9.9 | 1.1 / 3.2 s | 0.5 / 1.8 s | 0 | 0 / 0 |
| 25 staff | role-scoped; reused fixture (grown: Chair 79.5 KB, Executive 580 KB); PT409 client | 212 | 2,323 | 11.0 | 4.3 / 15.2 s | 2.4 / 14.7 s | 2 timeouts | 0 / 0 |
| 50 staff | role-scoped; **fresh** fixture; PT409 client | 410 | 5,786 | 14.1 | 6.9 / 85.4 s | 3.1 / 75.2 s | 10% (257 PGRST003 pool waits, 162 statement timeouts, 205 gateway timeouts) | 0 / 0 |

**Corrected harness + core read-path fix (PR #6 `121cbf1` + PR #9 `6fdf016`), fresh fixture, role-scoped, topic-aware Realtime, 50 staff × 5 min (19:14–19:19 UTC):** 424 writes, 2,046 full refreshes (4.8 per write, 4,092 snapshot RPCs); 2,734 refresh triggers, 698 dropped because the device was busy (never more than one refresh in flight per device); read p50/p95/p99 639 / 1,621 / 3,247 ms (Chair 477 / 985, Approval 422 / 2,698 on 25 refreshes, Admins 385 / 794 on 25, Executive 1,143 / 1,864); write p50/p95/p99 313 / 780 / 3,519 ms; 0 errors, 0 rate limits, 2 clean PT409 conflicts, 0 40001, 0 duplicates / 0 lost (19 scoring writes); no 500/504, PGRST003 or statement timeouts; all 11 API connections idle with no open transaction afterwards; outbox drained in 3 s. Approval and Admins refreshed 25 times each (open, focus, recovery) instead of on every Chair write; Executive (698 refreshes on 5 devices, 121 KB each) is now the largest read consumer. The harness verdict still flags "write p95" because it takes the worst *per-action* p95, which for 12–13-sample actions (`speechFinish`, `speechScore`) is their single slowest request (4.5 s / 3.6 s); the aggregate write p95 is 0.78 s.

**Same stack, fresh fixture, 100 staff × 5 min (19:26–19:32 UTC):** 795 writes, 3,442 full refreshes (4.3 per write, 6,884 snapshot RPCs); 7,008 triggers, 3,677 dropped while busy; read p50/p95/p99 1,693 / 9,179 / 23,223 ms (Chair 1,590 / 7,972; Approval 2,010 / 24,898 on 56; Admins 1,661 / 15,423 on 62; Executive 1,965 / 9,553 on 753); write p50/p95/p99 989 / 15,970 / 29,194 ms; 10 errors (9 statement timeouts on refreshes, 1 local health 503) = 0.23%; 77 clean PT409 conflicts (74 attendance: 5 Chair devices per floor at this scale share one roll call); 0 40001; 0 duplicates / 0 lost; 8 HTTP 500 (statement timeouts), no 504/PGRST003; API pool fully busy from ~19:28 to ~19:31 (no stuck transaction, longest ~10 s) and all idle afterwards; outbox drained in 66 s. Executive: 10 devices, 753 refreshes (1,769 triggers dropped), snapshot 121 KB at start → 458 KB after 703 writes (audit history), ~115–255 ms of database time per read versus ~65 ms for a Chair — roughly half the snapshot database time for 10% of devices.

**PR #6 `4cd8b3b` harness + core PR #10 `6ec9b21` (executive_snapshot, Executive 2 s Chair window), fresh fixture, 100 staff × 5 min, same compute tier (20:46–20:51 UTC):** 807 writes, 3,991 full refreshes (4.9 per write, 7,982 snapshot RPCs); 5,651 triggers, 1,705 dropped while busy; read p50/p95/p99 1,213 / 4,315 / 6,893 ms (Chair 1,126 / 4,205; Approval 1,211 / 5,553 on 48; Admins 1,090 / 3,910 on 53; Executive 1,385 / 4,454 on 940); write p50/p95/p99 621 / 3,776 / 6,147 ms; 0 errors, 0 rate limits, 63 clean PT409 (60 attendance), 0 40001, 0 duplicates / 0 lost; 0 statement timeouts, 0 HTTP 500/504, 0 PGRST003; up to 10 of 11 API connections active, longest observed transaction 0.6 s, all idle afterwards; outbox drained in 4 s. Executive: 7,290 Chair events → 1,170 fixed windows (6,120 coalesced), 940 refreshes on `executive_snapshot`; snapshot 121 KB at start → 170 KB after 729 changes (the same identity's `conference_snapshot` would be 474 KB). Versus the previous corrected 100-staff run: read p95 9.18 → 4.32 s, write p95 15.97 → 3.78 s, statement timeouts 9 → 0, HTTP 500 8 → 0, drain 66 → 4 s. The harness verdict still fails its 1.5 s / 2.5 s thresholds.

**Vercel Preview (`munos-meixm5pph`, development Supabase) + core PR #11 `1021788` (bundled snapshot RPC), PR #6 `7f83d40` harness, fresh fixture, 50 staff × 5 min, same compute tier (21:26–21:31 UTC):** 424 writes, 1,720 refreshes (4.1 per write), **1,720 snapshot RPCs (1.00 per refresh** — `pg_stat_statements`; no `conference_snapshot` / `executive_snapshot` / `operations_snapshot` calls in the edge logs); 2,040 triggers, 347 dropped while busy; read p50/p95/p99 586 / 2,304 / 6,092 ms (Chair 451 / 1,928; Executive 873 / 2,774 on 466); write p50/p95/p99 377 / 5,265 / 9,176 ms; 3 errors = 3 HTTP 500 statement timeouts (57014) on snapshot reads at 21:28:50; 8 clean PT409, 0 40001, 0 PGRST003, 0 504, 0 rate limits; 0 duplicates / 0 lost (19 scoring); outbox drained in 6 s; Vercel runtime errors: none. Origin p95 was 0.8–1.0 s except 21:28:00–21:29:00 (7.8–8.7 s) and 21:30:30 (5.6 s), when every function including writes stalled; cause not established (no other client on the project, no lock waits logged, all API connections idle afterwards). Write tails here are pessimistic for the single-committee reason above.

Fresh-fixture starting payloads (`conference_snapshot`, unloaded, 20 sequential reads): Chair 11.9 KB (p50 288 ms), Approval 10.8 KB (283 ms), Admins 10.8 KB (283 ms), Executive 121 KB (500 ms); `operations_snapshot` 81 bytes (~240 ms, network floor).

Findings: (1) explicit stale-write conflicts raised SQLSTATE 40001, which PostgREST retries; under load these became server-side retry loops that held every API connection for ~45 minutes after the client stopped — fixed by PT409 (PR #8), verified with 14 clean 409s and zero 40001 in the fresh 50-staff run; (2) the database stays correct under overload (no duplicate or lost writes in any run) and recovers on its own; (3) refresh volume, not write volume, saturates the 10-connection API pool — the core read path is being reduced (Codex), and the harness now models the production client exactly so the next fresh 50-staff run is comparable.

## Existing load tooling — findings

`npm run test:load` (`scripts/load-test.mts`) is kept as-is. It is a useful **burst/realtime stress test** but not a realistic rehearsal:
- locked to the development project (good); all clients share **one** authorized identity, so it says nothing about sign-up or shared-NAT limits;
- fires every client at once with no human pacing and no ramp stages;
- covers attendance, participation (+ duplicate retry), document creation and approval/print, and Realtime connect/reconnect, but not queues, timers, Google-Doc submissions, photo acknowledgements, refocus refetches or page loads;
- default and maximum 150/200 clients with no conservative default;
- overwrites the committed `docs/load-test-results.json`.

The new `npm run rehearsal:run` complements it: a human-paced staff role mix, a **separate delegate public-form population**, ramp stages, burst start windows, health/page/submission requests through the deployed app, retries with exactly-once verification, conservative defaults, production refusal, and results written to ignored `.test-sessions/`. In realistic readiness mode each simulated committee has its own Chair rehearsal identity (one per real committee) plus one Approval, one Admins and one Executive identity; the legacy single-Chair and all-roles modes remain only for historical comparison. Phase D covers fresh staff-device sign-in bursts separately.

## Rehearsal-day checklist

People: technical contact (Vercel + Supabase access), Executive, 3+ Chairs, Approval, Admins, 5 phones acting as delegates (public form only), one note-taker.

- [ ] Preview deployment URL (commit noted) and bypass secret in the operator's shell
- [ ] Staging Vercel project for the rollback drill, with Instant Rollback access
- [ ] Supabase project on **Pro with Small compute** (conference-week gate); migrations applied once; **one Chair rehearsal identity per committee** prepared (`npm run rehearsal:identities`); fresh multi-committee fixture applied
- [ ] `.env.local` for the development project; `npm ci` done on the operator laptop
- [ ] Test committee data, a submission link, test Google Docs set to Anyone with the link → Editor, plus one shared only with a Chair and one from a school that blocks link sharing
- [ ] Multiple browsers/devices: 2 Chair laptops for one committee, spare laptop, phones
- [ ] School Wi-Fi access (preferred) or one shared office network for the NAT test
- [ ] Vercel dashboard and Supabase dashboard open (Logs, Observability)
- [ ] Known-good release reference for the staging rollback drill
- [ ] Runbook, emergency sheet and this plan printed; results template ready (copy into `docs/VERIFICATION.md`)
