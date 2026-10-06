# Staging rehearsal plan

The complete rehearsal to run **before the conference**, after Codex's integration lands and a staging deployment exists. Nothing here runs against production. Owner: Claude (platform), with the Executive and one Chair per tested committee.

Conference OS is **staff software**; delegates are not users. Two load populations are tested **separately**:

| Population | Who | Realistic peak | Rehearsal target (headroom) | Touches |
| --- | --- | --- | --- | --- |
| **Staff app** | Chairs, Approval, Admins, Executive | ≈ 45–55 active devices (e.g. 14 committees × 2–3 Chair laptops + ~4 Approval + ~4 Admins + ~3 Executive) | **100, then 150–200** simulated staff devices | Supabase Auth session, snapshot reads, outbox writes, Realtime |
| **Delegate public form** | Delegations on phones | ≈ 100–150 page loads within a couple of minutes after "submissions open"; a few dozen submissions | **150–200** page loads in 2 minutes + submissions | `/submit/{token}` page and `POST /api/submissions` only — server-mediated, **no Supabase Auth session** |

A 100-person conference does not mean 100 simultaneous staff users; it does mean a delegate burst on the public form. Both must pass.

## Environments

| | Used for | Database |
| --- | --- | --- |
| **Vercel Preview** (any PR/branch) | Phases A–E | Development Supabase `opmydpozhdgkpcnjwpqb` |
| **Staging project** (a second Vercel project, e.g. `munos-staging`, production branch `staging`) | Phase F rollback drill — Instant Rollback only exists for a project's *production* deployments | Development Supabase |
| Production | **Never** used for load or failure tests | Production Supabase |

Previews have Vercel Authentication on; scripts use a *Protection Bypass for Automation* secret (`VERCEL_AUTOMATION_BYPASS_SECRET`, set only in the operator's shell).

## Preparation

1. Codex's integration merged to a branch; Preview deployed with development Supabase variables and `SUPABASE_SECRET_KEY` (dev).
2. All migrations applied to the **development** project (Codex-owned).
3. `.env.local` points at the development project (the scripts refuse anything else).
4. Authorized test session: `npx tsx scripts/prepare-session.mts` (stored in ignored `.test-sessions/`).
5. Synthetic rehearsal conference: `npx tsx scripts/prepare-load.mts`, then apply `.test-sessions/load-fixtures.sql` to the development project (SQL editor). It creates 4 committees, 150 delegates, active sessions, and grants the test identity every role for 4 hours.
6. Optional: create a submission link for one rehearsal committee (Executive → Submission links on the Preview) and note its token.
7. Dry-run the scenario: `npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10`.

## Phase A — Basic staging check (30 min)

- [ ] Preview URL opens; `npm run verify:deployment -- <preview-url> <commit>` passes.
- [ ] System health: GREEN, *Running version* = the Preview commit, environment `preview`, Supabase reachable, Storage `ok`.
- [ ] Each role on a separate browser: Chair (two committees), Approval, Admins, Executive.
- [ ] Google-Doc submission end to end: QR page → Delegate submissions → Open Google Doc → Submit to Approval → Approve → Print.
- [ ] Public form shows only committee, delegation selector, title, link, checkbox and fallback — no staff navigation; browser storage shows no Conference OS database and no Supabase session after submitting.
- [ ] Sharing matrix (see GOOGLE_WORKSPACE_ACCESS_MODEL.md §12): personal Gmail Doc on *Anyone with the link → Editor*; another school's Workspace Doc; a school account that blocks link sharing (direct share to a Chair, or file fallback); a Viewer-only link (Chair marks *Can't access*).
- [ ] Schedule import preview/confirm, group-photo slot with a reminder 10 minutes out.

## Phase B — Functional multi-user test (45 min, real people)

At least: 3 Chairs on 3 committees (one committee with **two** Chair laptops), 1 Approval, 1 Admins, 1 Executive, 5 phones as delegates.

Run a scripted mini-session: roll call, 10 speakers with queue advance, participation points, a POI point, two delegate submissions per committee, Chair → Approval → Print, one vote, a photo reminder, one schedule change. Record anything confusing or slow — usability findings matter as much as errors.

Verify: both laptops in the shared committee converge within a minute; conflicting edits produce a clear "review" message, not silent loss; Approval sees only Submitted+ resolutions.

## Phase C — Load ramp (60 min)

**C1 — Staff app ramp:** `npm run rehearsal:run -- --app <preview-url> --stages 25,50,100,150,200 --minutes 8`

**C2 — Staff + delegate burst together (realistic peak):** `npm run rehearsal:run -- --app <preview-url> --staff 50 --delegates 150 --delegate-window 120 --submit-token <token> --submit-committee GA1 --minutes 8`

The harness (`scripts/rehearsal-run.mts`) simulates **people, not requests**, in two populations:

| Simulated role | Share of staff | Behaviour |
| --- | --- | --- |
| Chair | 70% | opens committee; roll call (8 delegates, 3–8 s apart); then every 20–60 s one of: add speaker, participation, advance queue, timer, refocus refetch, Submit to Approval, photo acknowledgement; recovery read every ~60 s |
| Approval | 10% | reads every 30–90 s; approves a Submitted resolution occasionally |
| Admins | 10% | reads; marks Approved as Printed |
| Executive | 10% | reads; `/api/health` |
| **Delegate** (separate `--delegates N`) | — | loads the public QR page once inside the delegate window; 30% submit a Google Doc link 30–180 s later (with `--submit-token`). **No Supabase client, no session, no staff navigation**; delegations are picked from the fixture file for `--submit-committee`. |

Safety and realism built in: staff open within a 2.5-minute window (burst); **no person acts faster than every 3 s**; 10% of staff writes are immediately re-sent with the same id (simulated lost response); defaults are 10 staff, 0 delegates, 5 minutes; maximum 200 per population; refuses custom domains, bare `*.vercel.app` aliases and any target whose `/api/health` reports `production`; the Supabase side is locked to the development project; **no override exists**.

`npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10` (dry run): ≈ 128 staff requests/min and ≈ 73 staff writes/min for 50 staff devices (≤ 2.1 writes per person per minute), plus 150 public page loads and ≈ 47 submissions with **0 auth sessions**. The 200-staff stage is four times that.

Observe during each stage: harness p50/p95/p99 per action; Supabase *Observability* (CPU, connections, API latency), *Logs* (API errors, 429s, Auth); Vercel *Logs/Functions* (5xx, duration for `/api/*`, `/submit/*`); one real Chair browser kept open — is it still responsive?

Results: `.test-sessions/rehearsal-<time>.json` (ignored; contains samples). Copy the summary into `docs/VERIFICATION.md` by hand.

## Phase D — Burst start and shared NAT (45 min)

**Why it matters.** At the venue most devices share one public IP. Conference OS staff devices authenticate with Supabase Auth (anonymous sign-in, then an explicit access grant). Supabase limits **anonymous sign-ins per IP per hour** (default 30 — check the project's Auth rate-limit settings); token refreshes have their own per-IP limit. **Delegates on the QR page do not sign in**: verified in code — `/submit/*` skips the staff provider and device storage, and the page and `POST /api/submissions` are served by the server, which uses the server-only secret key without sessions. A delegate burst is therefore **not** an anonymous sign-in burst; shared-NAT auth risk is about **fresh staff devices**.

Test from **one network** (ideally the school Wi-Fi; otherwise one office connection):
1. **Prepared devices:** 30–60 browser profiles that already have sessions and grants (as on conference morning). Open all within 2–3 minutes. Expect: all reach GREEN; only token refreshes, no sign-ups.
2. **Fresh devices** (staging only, `NEXT_PUBLIC_ENABLE_ANONYMOUS_BOOTSTRAP=true` on the Preview): open N new profiles within 2–3 minutes (Playwright contexts or real laptops), N = 10, 25, 40. Record how many obtain a session, Auth log entries, HTTP 429s, and what the device shows (it must show RED "Not connected to the conference", never silently work locally).
3. **Delegate burst from one network (separate test):** 150–200 QR page loads within 2 minutes plus a few dozen submissions from the same public IP (`--staff 1 --delegates 200 --submit-token …`, or real phones on the school Wi-Fi). Expect: no auth activity at all in Supabase Auth logs; page p95 ≤ 2 s; submissions succeed (the only limit is 20 accepted submissions per committee link per 10 minutes — spread the test across committee links or expect 429s on one link by design); Vercel function errors 0.

Do **not** weaken security to pass: no blanket anonymous policies, no trusting client-supplied IPs. If fresh sign-ups hit the limit, the plan stands: prepare all staff devices in advance, stagger first sign-in, and set a measured Auth rate limit. Findings go to Codex:

> **CODEX REVIEW REQUIRED — DESIGN ONLY:** the future access-code exchange must give each staff device one stable identity, must not create a new anonymous user per navigation or refresh, must handle replacement laptops deliberately, and should be measured against the per-IP limits above from a single NAT.

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

**PASS (all required):**
- Staff app at **100** simulated staff devices (about twice the realistic peak): error rate < 1% (conflicts excluded), write p95 ≤ 1.5 s, read p95 ≤ 2.5 s, no rate-limit responses; real Chair browsers stay responsive.
- Staff app at **150–200**: no systemic failure (no cascading errors, no stuck devices); latency may rise but operations complete.
- Delegate public form: 150–200 page loads in 2 minutes with page p95 ≤ 2 s and no 5xx; submissions succeed apart from the designed per-link limit; **zero Supabase Auth activity** from delegates.
- Burst start of prepared devices: all reach GREEN within 3 minutes.
- Zero duplicate and zero lost writes after retries and offline/reconnect.
- Realtime loss never stops core operations.
- Rollback completed and verified in under 5 minutes.
- No critical security/RLS findings (Supabase Advisors clean; no anonymous grants).

**FAIL (any):** sign-in/auth burst breaks prepared devices · duplicated queue/participation entries · offline changes disappear · database latency makes chairing impractical (several seconds per action) · any Drive or Google dependency blocks core workflow · rollback cannot be completed confidently.

Thresholds are starting points from the current architecture; record actual numbers and adjust with Codex if the data says otherwise. The earlier single-identity burst test (`docs/load-test-results.json`) showed high burst read latency, so read p95 under burst is the number to watch first.

## Existing load tooling — findings

`npm run test:load` (`scripts/load-test.mts`) is kept as-is. It is a useful **burst/realtime stress test** but not a realistic rehearsal:
- locked to the development project (good); all clients share **one** authorized identity, so it says nothing about sign-up or shared-NAT limits;
- fires every client at once with no human pacing and no ramp stages;
- covers attendance, participation (+ duplicate retry), document creation and approval/print, and Realtime connect/reconnect, but not queues, timers, Google-Doc submissions, photo acknowledgements, refocus refetches or page loads;
- default and maximum 150/200 clients with no conservative default;
- overwrites the committed `docs/load-test-results.json`.

The new `npm run rehearsal:run` complements it: a human-paced staff role mix, a **separate delegate public-form population**, ramp stages, burst start windows, health/page/submission requests through the deployed app, retries with exactly-once verification, conservative defaults, production refusal, and results written to ignored `.test-sessions/`. Simulated staff still share one identity — Phase D covers fresh staff-device sign-in bursts separately.

## Rehearsal-day checklist

People: technical contact (Vercel + Supabase access), Executive, 3+ Chairs, Approval, Admins, 5 phones acting as delegates (public form only), one note-taker.

- [ ] Preview deployment URL (commit noted) and bypass secret in the operator's shell
- [ ] Staging Vercel project for the rollback drill, with Instant Rollback access
- [ ] Development Supabase: migrations applied, synthetic rehearsal conference loaded, test identity authorized
- [ ] `.env.local` for the development project; `npm ci` done on the operator laptop
- [ ] Test committee data, a submission link, test Google Docs set to Anyone with the link → Editor, plus one shared only with a Chair and one from a school that blocks link sharing
- [ ] Multiple browsers/devices: 2 Chair laptops for one committee, spare laptop, phones
- [ ] School Wi-Fi access (preferred) or one shared office network for the NAT test
- [ ] Vercel dashboard and Supabase dashboard open (Logs, Observability)
- [ ] Known-good release reference for the staging rollback drill
- [ ] Runbook, emergency sheet and this plan printed; results template ready (copy into `docs/VERIFICATION.md`)
