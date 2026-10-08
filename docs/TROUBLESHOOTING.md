# Troubleshooting — for the technical contact

Organizer runbook: [CONFERENCE_RUNBOOK.md](../CONFERENCE_RUNBOOK.md). One-page emergency sheet: [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md). Deployment and rollback: [DEPLOYMENT.md](DEPLOYMENT.md).

## Reading System health

System health shows **that device's** view, in every staff workspace: Chair `/chair/health`, Approval `/approval/health`, Admins `/logistics/health`, Executive `/admin/health` (each in its own sidebar). Role routing is unchanged: a Chair opening `/admin/health` is sent back to `/chair`. *Technical details*:

| Field | Meaning |
| --- | --- |
| Data mode | `Conference database` = connected to Supabase. `Local fallback (cloud expected)` = this device has no authorized session → RED; enter a staff access code (below). `Local demo` = demo build. |
| Sync state / Last error | Outbox state and the last transport error (raw). |
| Database latency | Time of the last snapshot read. > 3 s shows YELLOW "slow". |
| Unsynced / conflicts | Outbox length / changes the server rejected (RED until reviewed). |
| Device user | The Supabase auth user id of this device (its identity for grants and audit; useful when revoking a single device's grant). |
| Build | Version, commit, branch, environment, deployment id — compare with the known-good card. |
| Service check | `/api/health`: Supabase Auth reachability and (if `SUPABASE_SECRET_KEY` is set) the `resolutions` Storage bucket. |

`GET /api/health` returns the same build identity and checks as JSON (cached 15 s).

## Access for a device

Staff devices get access with **staff access codes** (Executive → Access codes). The gate creates the device's anonymous Supabase identity only when a code is submitted, then `redeem_access_code` turns the code into a normal `public.user_access` grant (role and committee come from the code, never from the device). Each device that uses a code gets its own identity and grant.

- Code scopes: Chair (per committee), Approval Panel (`approval`), Admins (`logistics`), Executive (`admin`). One active code per scope; *Rotate* replaces it (devices already prepared keep their grants until expiry); *Revoke* stops new redemptions, and with *Also revoke devices using this code* also revokes the grants created from it.
- Prepared devices keep working offline until the earlier of 48 hours after their last access check or grant expiry; then they show "Conference access" and can still export pending work.
- Archiving a committee revokes its Chair codes **and** Chair grants in the same transaction; new Chair codes for an archived committee are refused. There is no unarchive in the app.
- Redemption is rate limited ("Too many attempts. Please wait 10 minutes…"). Anonymous sign-ins are also limited per IP by Supabase Auth: prepare devices the day before, a few at a time.
- **First Executive on a new project:** the app cannot issue the first code (issuing requires an Executive grant). Use the one-time bootstrap: [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) (`scripts/bootstrap-first-executive.sql`). Never insert `user_access` rows by hand and never add blanket or anonymous policies to work around access problems.

## Unsynced changes and conflicts

- Changes are saved in the browser (IndexedDB) **before** they appear on screen and are sent in order with a stable id; a retry after a lost response is applied exactly once by the server.
- A **conflict** (another device changed the same item, or access changed) stops later changes from that device until reviewed. On that device: *Export device recovery file* first, check the current value in Conference OS, then *Keep conference value · dismiss exported action* and re-enter the intended change if still needed.
- Unsynced changes **never leave the device** by themselves. A replacement laptop only sees server-confirmed work.
- Recovering a dead laptop: keep it **offline**, open its workspace and then System health from the sidebar, export the recovery file, then decide whether to let it sync (duplicates are possible if the same changes were re-entered elsewhere). The file is JSON: `pending[]` lists each unsynced command.
- A device that has not been online for 48 hours (or whose grant expired) stops opening the cached conference offline.

## Conflicts (`PT409`) and other "needs review" codes

The client marks a saved action "needs review" when the server answers `PT409` (stale revision, archived session/committee, the item changed elsewhere), `40001`, `42501` (access changed) or a `22xxx`/`23xxx` validation error. The action stays in the device outbox and blocks later actions until someone exports and dismisses it in **that device's** System health (any staff role, see above); the later actions then sync. There is no server-side retry of a rejected action; re-entering it creates a new action. Sign-out is refused while such actions exist unless access is gone and a recovery export has been downloaded.

## Supabase

- Status: [status.supabase.com](https://status.supabase.com/). Project dashboard → *Logs* (API, Auth, Realtime, Postgres) and *Observability* for CPU/connections; *Advisors* for security/performance findings.
- **Anonymous sign-in rate limit** (shared school IP): fresh devices failing to start with auth errors during a burst means the per-IP limit was hit. Do not lower security; stagger device start-up, reuse prepared devices, and review the project's auth rate limits in the dashboard ahead of time. See [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md#phase-d--burst-start-and-shared-nat-45-min).
- Backups: confirm the daily backup (plan-dependent) or take an export at the end of each day. Verify restore steps before the conference.
- A Vercel rollback never changes the database. Migrations are never applied during the freeze.

## Vercel

- Production is built only from the `production` branch; pushes to `main` create Previews ([DEPLOYMENT.md](DEPLOYMENT.md)).
- Deployments → the production deployment → *Logs* / *Functions* for server errors (`/api/health`, `/api/submissions`, `/submit/*`, `/api/amendments`, `/amend/*`).
- Verify a deployment: `npm run verify:deployment -- <url> [expected-commit]`.
- Rollback: [DEPLOYMENT.md](DEPLOYMENT.md#rollback). After rollback, new builds stop auto-promoting until you undo it.

## Resolution submission

| Symptom | Cause / fix |
| --- | --- |
| "Online submission is not available right now" | `SUPABASE_SECRET_KEY` missing on that Vercel environment. Add it (Sensitive), redeploy. |
| "Submission is temporarily unavailable" on the page | The server could not reach Supabase. Check Supabase status. |
| "This submission link is not valid" | Link replaced or turned off (Executive → Submission links), or mistyped. Print the current room sheet. |
| "Too many submissions…" | 20 per link per 10 minutes. Wait, or replace the link if it leaked. |
| "This committee has no session yet" | Create the conference sessions in Executive → **Sessions** (they are created for every active committee). |
| Chair can't open a Doc | Doc still Restricted, set to Viewer, shared with the wrong Chair, or the delegate's school blocks sharing outside it. Ask for *Anyone with the link → Editor*, or a direct share with a Chair; otherwise the file-upload fallback. See [GOOGLE_WORKSPACE_ACCESS_MODEL.md](GOOGLE_WORKSPACE_ACCESS_MODEL.md) §6. |
| Uploads fail, Google Docs links work | Storage problem; `/api/health` storage check shows it. Google Doc submissions are unaffected. |

Conference OS stores only the Google Doc id and never calls Google; it cannot see whether sharing is correct.

## Amendment submission

| Symptom | Cause / fix |
| --- | --- |
| "Amendments are not currently open in this committee." | No resolution is In Debate in that committee's current session. Expected between debates. |
| "This amendment link is not valid" | Link replaced or turned off (Executive → Amendment links), or the committee was archived. Print the current sheet. |
| "Online amendments are temporarily unavailable" | Server cannot reach Supabase or `SUPABASE_SECRET_KEY` missing on that Vercel environment. |
| Rate-limited | 20 per link and 5 per delegation per 10 minutes. Replace the link if it leaked. |
| Same amendment submitted twice | Retries with the same submission are replayed, identical wording from the same delegation returns the existing amendment; nothing is duplicated. |

## Group-photo reminders

Derived on each device from slot times and the **device clock** every 15 seconds; no server push. Wrong time on a laptop = wrong reminder timing (time zone doesn't matter, the clock does). A changed slot (time/place) re-alerts chairs who had acknowledged. Executive sees acknowledgements per committee (✓ warned, ✓✓ sent).

## Offline shell

The production service worker (`public/sw.js`) prepares a fixed set of static pages after one online visit: the Chair Console pages (`/chair`, roll call, participation, documents, amendments, voting, photos) and every staff System health page (`/chair/health`, `/approval/health`, `/logistics/health`, `/admin/health`). Navigation is network-first; only when the network fails does it serve the prepared page. API, Auth, Supabase and form submissions are never cached or served by it. Data comes from the device's IndexedDB. Approval inbox and Print queue pages are not in the offline set. Prepare each device online once; after a deployment, a refresh picks up the new version (the version-mismatch notice in System health tells you when).

## After the conference

Connect every device and confirm 0 unsynced. Then revoke every access code with *Also revoke devices using this code*, clear confirmed conference data from shared laptops (each browser profile), delete device recovery files once reconciled, and remove the production freeze flag.
