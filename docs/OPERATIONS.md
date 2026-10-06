# Conference-day technical notes

> The organizer-facing runbook is [CONFERENCE_RUNBOOK.md](../CONFERENCE_RUNBOOK.md). Deployment, freeze and rollback detail is in [DEPLOYMENT.md](DEPLOYMENT.md). This page keeps the original technical notes for the technical contact.

**Development baseline only.** No production project or known-good Vercel deployment has been established. Name a lead administrator and deputy before the rehearsal; record their contact details and exact authorized accounts here.

## Before opening

- Freeze routine production changes 48 hours before opening. Keep one identified, tested Vercel production deployment as the conference release.
- Complete a staging rehearsal, load test and distinct-user startup test on the actual school Wi-Fi. Include a school-managed laptop/tablet and the shared public IP.
- Verify all committees, delegates, sessions, access codes and replacement-device procedures.
- Prepare each Chair Console online, then disconnect and refresh to prove its offline shell works.
- Check System health on every device: real conference connected, no outstanding conflicts or unsynced actions.
- Export a database snapshot and verify restore steps. Export essential attendance/committee records and download all current documents for offline fallback.
- Once implemented, verify Drive archive copies and PDF opening. **Drive/PDF integration does not exist in this baseline; do not assume an archive is present.**
- Record the Vercel release URL/ID, domain, application version and compatible database migration versions. Rehearse rollback on staging first.

## During conference

- Green: connected, changes synced. Continue normally.
- Yellow: connection/live updates interrupted. Previously prepared Chair screens can continue timer, queue, attendance and scoring. The device retains changes and retries. Stay on the same browser/profile.
- Red: a change needs review or device storage is unavailable. Ask the administrator. Export recovery data before dismissing any conflicting action. Do not repeatedly re-enter the same change.
- If Wi-Fi fails, keep the working laptop. Never clear browser data or switch laptops while its operations are waiting. A replacement laptop sees only server-confirmed work.
- If the app cannot open, use the prepared paper attendance/speaker log and downloaded resolution files. Record times and authors for later reconciliation. Do not improvise duplicate entries in two places.
- Once Drive exists, use its archived PDFs as read-only fallback; do not rename folders to represent workflow state. Keep a manual incident log for later reconciliation.

## After each day

Connect all devices, confirm zero unsynced actions, review conflicts, export a database snapshot and check archive health. Record incidents and fixes. Never deploy routine features during the conference. Remove recovery exports once reconciled and securely retained elsewhere. Clear confirmed conference data from shared laptops after the event, checking every browser/profile for unsynced actions first.

## Emergency checks and rollback

1. Check [Supabase status](https://status.supabase.com/) and [Vercel status](https://www.vercel-status.com/). Use System health to distinguish internet, database and live-update problems.
2. Preserve/export outstanding device operations. A deployment rollback does not restore a database or recover an unsynced laptop.
3. In Vercel, open the project overview → Production Deployment → **Instant Rollback**.
4. Select the recorded eligible known-good deployment → **Continue**. Verify domains and configuration, then **Confirm Rollback**.
5. Open Chair and System health on a test device, verify a read/write and ensure the database schema remains compatible. Keep the other devices on their running screen until the administrator coordinates refresh.
6. Vercel disables automatic production-domain assignment after rollback. Do not undo the rollback until the replacement is verified.

Vercel Hobby supports the immediately previous production deployment; Pro/Enterprise can choose eligible prior production deployments. Preview-only deployments are not automatically eligible. Rollback restores the earlier build/configuration, not external database state. See [official rollback instructions](https://vercel.com/docs/instant-rollback).

Any emergency change must be narrowly scoped, tested on staging, reversible and cross-reviewed. No routine conference-day deployments. Actual rollback rehearsal remains pending because this task does not deploy to Vercel.
