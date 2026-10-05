# Troubleshooting — for the technical contact

Organizer runbook: [CONFERENCE_RUNBOOK.md](../CONFERENCE_RUNBOOK.md). One-page emergency sheet: [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md). Deployment and rollback: [DEPLOYMENT.md](DEPLOYMENT.md).

## Reading System health

`/admin/health` on any device shows **that device's** view. *Technical details*:

| Field | Meaning |
| --- | --- |
| Data mode | `Conference database` = connected to Supabase. `Local fallback (cloud expected)` = this device has no authorized session → RED; grant access (below). `Local demo` = demo build. |
| Sync state / Last error | Outbox state and the last transport error (raw). |
| Database latency | Time of the last snapshot read. > 3 s shows YELLOW "slow". |
| Unsynced / conflicts | Outbox length / changes the server rejected (RED until reviewed). |
| Device user | The Supabase auth user id of this device — needed to grant access. |
| Build | Version, commit, branch, environment, deployment id — compare with the known-good card. |
| Service check | `/api/health`: Supabase Auth reachability and (if `SUPABASE_SECRET_KEY` is set) the `resolutions` Storage bucket. |

`GET /api/health` returns the same build identity and checks as JSON (cached 15 s).

## Access for a device

There is no access-code login yet. A device signs in anonymously (when `NEXT_PUBLIC_ENABLE_ANONYMOUS_BOOTSTRAP=true`) or reuses its session; it gets data only after an explicit grant in `public.user_access`.

1. On the device: System health → *Technical details* → copy **Device user**.
2. Supabase dashboard → SQL editor (production project), as an authorized administrator:

```sql
-- One row per role; Chair rows need a committee. Short expiry; revoke afterwards.
insert into public.user_access (conference_id, user_id, role, committee_id, expires_at)
values ('<conference-uuid>', '<device-user-id>', 'chair', '<committee-uuid>', now() + interval '4 days');
```

3. Reload Conference OS on the device.

**Spare laptops:** add one `chair` row per committee for the spare device's user id. Prepare them before the conference and open Chair Console once online (this also caches the offline shell). Never add blanket or anonymous policies to work around access problems.

## Unsynced changes and conflicts

- Changes are saved in the browser (IndexedDB) **before** they appear on screen and are sent in order with a stable id; a retry after a lost response is applied exactly once by the server.
- A **conflict** (another device changed the same item, or access changed) stops later changes from that device until reviewed. On that device: *Export device recovery file* first, check the current value in Conference OS, then *Keep conference value · dismiss exported action* and re-enter the intended change if still needed.
- Unsynced changes **never leave the device** by themselves. A replacement laptop only sees server-confirmed work.
- Recovering a dead laptop: keep it **offline**, open `/admin/health`, export the recovery file, then decide whether to let it sync (duplicates are possible if the same changes were re-entered elsewhere). The file is JSON: `pending[]` lists each unsynced command.
- A device that has not been online for 48 hours (or whose grant expired) stops opening the cached conference offline.

## Supabase

- Status: [status.supabase.com](https://status.supabase.com/). Project dashboard → *Logs* (API, Auth, Realtime, Postgres) and *Observability* for CPU/connections; *Advisors* for security/performance findings.
- **Anonymous sign-in rate limit** (shared school IP): fresh devices failing to start with auth errors during a burst means the per-IP limit was hit. Do not lower security; stagger device start-up, reuse prepared devices, and review the project's auth rate limits in the dashboard ahead of time. See [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md#phase-d--burst-start-and-shared-nat).
- Backups: confirm the daily backup (plan-dependent) or take an export at the end of each day. Verify restore steps before the conference.
- A Vercel rollback never changes the database. Migrations are never applied during the freeze.

## Vercel

- Deployments → the production deployment → *Logs* / *Functions* for server errors (`/api/health`, `/api/submissions`, `/submit/*`).
- Verify a deployment: `npm run verify:deployment -- <url> [expected-commit]`.
- Rollback: [DEPLOYMENT.md](DEPLOYMENT.md#rollback). After rollback, new builds stop auto-promoting until you undo it.

## Resolution submission

| Symptom | Cause / fix |
| --- | --- |
| "Online submission is not available right now" | `SUPABASE_SECRET_KEY` missing on that Vercel environment. Add it (Sensitive), redeploy. |
| "Submission is temporarily unavailable" on the page | The server could not reach Supabase. Check Supabase status. |
| "This submission link is not valid" | Link replaced or turned off (Administrator → Submission links), or mistyped. Print the current room sheet. |
| "Too many submissions…" | 20 per link per 10 minutes. Wait, or replace the link if it leaked. |
| "This committee has no session yet" | Create/import the committee's sessions. |
| Chair can't open a Doc | Delegate shared with the wrong account or as Viewer. Sharing address is per committee (Administrator → Submission links). |
| Uploads fail, Google Docs links work | Storage problem; `/api/health` storage check shows it. Google Doc submissions are unaffected. |

Conference OS stores only the Google Doc id and never calls Google; it cannot see whether sharing is correct.

## Group-photo reminders

Derived on each device from slot times and the **device clock** every 15 seconds; no server push. Wrong time on a laptop = wrong reminder timing (time zone doesn't matter, the clock does). A changed slot (time/place) re-alerts chairs who had acknowledged. Executive sees acknowledgements per committee (✓ warned, ✓✓ sent).

## Offline shell

The production service worker caches Chair Console pages (`/chair…`, `/admin/health`) after one online visit; Supabase responses are never cached by it. Data comes from the device's IndexedDB. Prepare each device online once; after a deployment, a refresh picks up the new version (the version-mismatch notice in System health tells you when).

## After the conference

Connect every device and confirm 0 unsynced. Then clear confirmed conference data from shared laptops (each browser profile), delete device recovery files once reconciled, revoke `user_access` grants, and remove the production freeze flag.
