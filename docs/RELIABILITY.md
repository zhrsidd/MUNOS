# Reliability review — Claude-owned subsystems

Target: ~100 simultaneous users, 150–200 headroom, one school network, no IT team. This review covers only what Claude added (deployment, health, submission, schedule import, group photos). Core load characteristics are in [VERIFICATION.md](VERIFICATION.md).

## Load added per device

| Source | Network cost | Notes |
| --- | --- | --- |
| Snapshot read | No extra request since PR #11: `operations_snapshot` is folded into the one bundled state-snapshot RPC (originally +1 small parallel RPC) | Reads already happen after a sync, on focus/online, on a Realtime notification and every ~60 s. Extension tables are small (≤ a few thousand rows). RLS-scoped: chairs read only their committee's acknowledgements and links. |
| Health indicator / status strip | none | Derived from the device's own sync state and `navigator.onLine`; re-evaluated locally every 30 s. |
| System health screen | `GET /api/health` once a minute **only while that screen is visible**, plus on reconnect | Response is CDN-cacheable for 15 s and each server instance probes Supabase at most once per 15 s. |
| Photo reminders | none | Derived from cached slot timestamps every 15 s on the device. No polling, no WebSocket dependency, no timer ticks over the network. |
| Photo acknowledgement | 1 outbox write per committee per slot stage | ≈ schools × affected committees × 2 over the whole conference. |
| Schedule / photo import | 1 write per import | One atomic command; ≤ 500 sessions / ≤ 300 slots. |
| Delegate submission page | 1 RPC per page view, cached 30 s per link per server instance | A room scanning the QR at once costs one lookup. |
| Delegate submission | Google Doc link: 1 lookup + 1 RPC (no Storage, no Google API call). Fallback file: + 1 Storage upload | ~150 submissions per conference. Committee-row lock held for one short transaction. |

Realtime: no new channels. Extension writes insert into the existing `operational_changes` table, so every device keeps its one filtered subscription. Changes affecting several committees insert one small row per affected committee (photo slots, schedule import) so only those chairs refresh early; everyone else picks changes up on the normal recovery read.

## Conference-day failure modes

| Condition | Effect on Claude subsystems |
| --- | --- |
| Realtime down | Health YELLOW. Reminders unaffected (local derivation). Schedule/photo changes arrive within ~60 s via recovery reads. |
| Wi-Fi down on a Chair laptop | Health YELLOW (RED after 15 min of unsynced changes, as an escalation prompt — data is still safe). Reminders keep working from the cached snapshot. Acknowledgements queue in the outbox. `/chair` and `/chair/photos` open offline once prepared. |
| Supabase down | Health YELLOW "database unreachable". Submissions fail with a clear "NOT submitted" message; delegates keep the Google Doc and submit the link later. Reminders keep working. |
| Storage down | Health YELLOW "Document storage is temporarily unavailable". Only the file-upload fallback fails (503, nothing created); Google Doc submissions continue. Debate/attendance/voting unaffected. |
| Google Docs / Google sign-in down | Conference OS keeps tracking the workflow; Chairs cannot open documents until Google recovers. Delegates can use the file-upload fallback. |
| App (Vercel) down | Open Chair screens keep working offline. Rollback procedure in DEPLOYMENT.md. |
| Lost response during submission | Retry with the same submission UUID returns the original reference (`replayed`). |
| Device time zone wrong | No effect: times are stored as instants and shown in the conference zone. |
| Device clock wrong | Reminders shift by the clock error. Conference devices should use automatic time (runbook checklist). |
| Extension migration not applied | Core continues; `operations_snapshot` missing is tolerated; extension screens are empty. |

## Deliberately not added

No Redis, queue, cron job, second database, push service or monitoring platform. Vercel's deployment history/logs and Supabase's dashboard/advisors remain the operational tools; `/api/health` can be pointed at by one external uptime checker.

## Open items

- A real load test against a deployed Preview has not been run yet. The full plan (ramp to 200, burst start, shared NAT, failure injection, rollback drill) and the human-paced harness (`npm run rehearsal:plan` / `rehearsal:run`) are in [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md).
- Per-IP rate limiting of `/api/submissions` is not implemented (link possession + per-link limit only). Vercel's platform DDoS protection applies; add a Vercel Firewall rule if abuse is observed.
