# Conference runbook

For conference organizers. No technical knowledge needed. Keep a printed copy in the operations room.

**Fill in before the conference:**

| | Name | Phone |
| --- | --- | --- |
| Executive (lead) | | |
| Executive (deputy) | | |
| Technical contact | | |
| School IT / Wi-Fi contact | | |

Known-good release card: attach the printed card from `docs/RELEASES.md`.
Health page: **Executive → System health** (`/admin/health`).

---

## The three colours

System health shows one colour. Every Conference OS screen also shows a strip at the top when something is not GREEN.

| Colour | Meaning | What to do |
| --- | --- | --- |
| **GREEN** — All systems operational | Everything is saving and syncing. | Carry on. |
| **YELLOW** — Degraded | Something is slow or temporarily unavailable, but committees can keep working. Changes are kept on the device and sync automatically. | Carry on. Do not close the laptop or clear the browser. Check again in 5 minutes. If it lasts more than 15 minutes, follow the matching procedure below. |
| **RED** — Action needed | A device cannot save, changes need review, changes have been waiting more than 15 minutes, or the device is not connected to the conference. | Stop recording on that device. Call the Executive. Do **not** clear browser data or switch laptops. |

Common messages:

- *"Live updates temporarily unavailable. Committee operations can continue."* → YELLOW. Screens still refresh at least once a minute.
- *"Internet unavailable. 4 changes are saved on this device and will sync automatically."* → YELLOW. Keep the laptop open.
- *"Document storage is temporarily unavailable."* → YELLOW. Only uploads and opening files are affected. Debate, attendance and voting continue.
- *"Not connected to the conference"* → RED. This device has not been set up; nothing it records is shared.

---

## Before the conference (one week to 48 hours before)

- [ ] **Known-good release.** System health → *Running version* matches the printed known-good card. Production is frozen 48 hours before opening (no changes except emergencies).
- [ ] **Supabase.** Technical contact confirms the production database is healthy and a backup/export exists.
- [ ] **Committees.** Every committee exists with the right code, name and room.
- [ ] **Delegates.** Delegate import complete; spot-check five delegates per committee (country, school, committee).
- [ ] **Sessions.** Executive → Sessions → *Import schedule*; review the preview and confirm. Each committee shows the right sessions with correct times.
- [ ] **Document upload.** For each committee, open its submission QR link on a phone and submit a test PDF. It must appear in the Approval inbox. Delete/withdraw the test afterwards.
- [ ] **Approval workflow.** Approval Panel approves the test resolution.
- [ ] **Admin print workflow.** Admins/print team marks it printed.
- [ ] **School Wi-Fi.** Test in every committee room: open Conference OS, check System health is GREEN. Note rooms with weak signal.
- [ ] **Conference devices.** Each Chair laptop: date and time set automatically (group-photo reminders use the device clock); sign in once, open Chair Console and Chair Console → Group photos, open System health (GREEN, 0 unsynced). Then turn Wi-Fi off, refresh, and confirm the Chair Console still opens. Turn Wi-Fi back on.
- [ ] **Health page.** Executive can open System health and explain the three colours.
- [ ] **Fallback material.** Print per committee: delegate list, blank attendance sheet, blank speakers list, submission QR sheet. Download current resolutions.
- [ ] **Photo schedule.** Executive → Group photos: every school has its slot(s), times and location are right, and the affected committees look sensible.
- [ ] **Submission QR sheets.** Print one per committee room (Chair Console → Documents → *Print room sheet*).
- [ ] **Access.** Every Chair, Approval, Admins and Executive device has working access. (Access-code entry, when it exists: test one code per role.)

## Conference morning (every day, 45 minutes before sessions)

- [ ] **System health** on the Executive device: GREEN, running version matches the known-good card.
- [ ] **Chair test.** In one committee: mark one delegate present, add a speaker, start and stop the timer. Undo afterwards if needed.
- [ ] **Resolution submission test.** Scan one committee's QR code with a phone and submit a test file. Confirm it appears in Approval.
- [ ] **Approval test.** Approve the test resolution.
- [ ] **Admin print test.** Mark it printed.
- [ ] **SC voting test** (once Security Council veto handling exists): run one practice vote in SC.
- [ ] **No unsynced changes.** Every Chair laptop: sidebar shows GREEN / "Synced". Any device showing unsynced or "need review" → Executive resolves it before sessions start.
- [ ] Today's group photos: check the list for today in Executive → Group photos.

## During the conference

### Wi-Fi outage (internet unavailable)

1. Chairs keep working. Attendance, speakers, timer and scoring keep saving on the laptop (YELLOW).
2. Do **not** close laptops, switch laptops, clear browser data, or "log out".
3. Resolution submission needs internet: delegates wait, or hand the file to the Chair on a USB stick for later upload.
4. When Wi-Fi returns, changes sync automatically. Check each laptop returns to GREEN.
5. Over 15 minutes → the device turns RED as a reminder. It is still safe; keep it open. Use paper for anything new only if the Chair cannot use the laptop.

### Live updates (Realtime) outage

YELLOW *"Live updates temporarily unavailable"*. Nothing to do. Screens refresh at least every minute and whenever a page regains focus. Group-photo reminders still appear on time (they are calculated on each device, not sent live).

### Resolution upload failure

1. The delegate sees "not received" — nothing was submitted. Ask them to try again once (it is safe; duplicates are detected).
2. Still failing: check System health → *Document storage*. If YELLOW, uploads are temporarily unavailable.
3. Fallback: the delegate emails the file to the submission contact shown on the page, or gives it to the Chair. Approval records it once storage returns.

### Supabase (database) outage

1. System health: *Conference database unreachable* on every device. Check [status.supabase.com](https://status.supabase.com/).
2. Chairs keep working on their laptops; changes are kept and sync later.
3. Resolution submission, approval and printing stop until it returns. Use the printed fallback material.
4. Do not refresh laptops repeatedly; leave them on their current screen.

### Application outage (Conference OS will not open)

1. Check on a phone using mobile data: does the site open? Check [vercel-status.com](https://www.vercel-status.com/).
2. Laptops already open on Chair Console keep working; do not close them.
3. If a recent emergency change caused it, the technical contact rolls back (see Emergency).
4. Otherwise use paper fallback; record times and who did what for later entry.

## End of each day

- [ ] Every laptop: GREEN, **0 unsynced changes**. Leave any laptop with unsynced changes open and connected until it syncs.
- [ ] Any RED "need review" → Executive exports the recovery file from that device, then reviews.
- [ ] Document archive: Approval inbox and print queue are empty or understood; download the day's approved resolutions.
- [ ] Database export/backup: technical contact confirms a backup exists for today.
- [ ] Tomorrow's schedule: each committee's sessions for tomorrow are present with the right times.
- [ ] Tomorrow's group-photo slots: correct times and locations; cancelled slots are marked cancelled.
- [ ] Write down any incidents (time, room, what happened, what was done).

## Emergency

### Return to the known-good release (Vercel rollback)

Only the technical contact or the Executive with Vercel access.

1. Vercel → the Conference OS project → **Deployments**.
2. Find the deployment whose commit matches the **known-good card**.
3. **⋯ → Instant Rollback → Continue → Confirm Rollback**.
4. On one device open System health. *Running version* must match the card.
5. Then ask chairs to refresh — but only devices showing **0 unsynced changes**.

A rollback changes the application only. It does not change the database or delete anything saved on laptops. Full detail: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#rollback).

### Check Supabase

[status.supabase.com](https://status.supabase.com/). If Supabase has an incident, there is nothing to roll back; keep laptops open and use fallback material.

### Drive fallback

Not available yet. Google Drive archive copies will be added later. Until then, download approved resolutions at the end of each day.

### Spreadsheet / paper fallback (only if absolutely necessary)

Use the printed attendance sheet, speakers list and downloaded resolutions. Write times and names. Do **not** enter the same thing in two places at once. After recovery, one person enters the paper records into Conference OS.

### Emergency fix during the freeze

Only for something that blocks the conference. It must be small, tested, checked on a Preview first, and have the known-good release ready for rollback. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#production-freeze).
