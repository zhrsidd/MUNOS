# Emergency recovery — one page

Print this. Phone numbers are in the runbook. **First rule: never clear a browser, log out, or swap a laptop that shows unsynced changes.**

**Conference OS isn't loading**
1. Try a phone on mobile data. If it opens there, the problem is the school network (see Wi-Fi).
2. If it opens nowhere: check [vercel-status.com](https://www.vercel-status.com/) and [status.supabase.com](https://status.supabase.com/).
3. Laptops already showing Chair Console keep working offline. Don't close them.
4. If a change was deployed recently, the technical contact **returns to the known-good release** (below).
5. Otherwise use the printed attendance and speakers sheets until it returns.

**Wi-Fi is down**
Keep chairing. Changes save on each laptop (YELLOW) and sync when Wi-Fi returns. Delegates keep writing in Google Docs and submit links later (phones on mobile data can submit now). Over 15 minutes the device turns RED as a reminder — still safe, keep it open.

**Google Docs / Drive is down**
Conference OS keeps working: roll call, speakers, timer, participation, votes, resolution workflow. Only opening or copying documents waits. Check [Google Workspace status](https://www.google.com/appsstatus/dashboard/).

**A Chair laptop died**
Take a spare laptop (already given access to every committee) → Chair Console → choose the committee → check *Current session*, roll call and speaker queue → continue. Changes the dead laptop had **not synced** stay on it. If it comes back: **before** reconnecting it, open `/admin/health` on it, *Export device recovery file*, and give it to the technical contact.

**A deployment is broken** (errors after an update, wrong version shown)
Return to the known-good release (below). Do not try to fix forward during the conference.

**Return to the known-good release** (technical contact or Executive with Vercel access)
1. vercel.com → Conference OS project → **Deployments**.
2. Find the deployment whose commit matches the **known-good card**.
3. **⋯ → Instant Rollback → Continue → Confirm Rollback**.
4. On one device: Executive → System health → *Running version* matches the card.
5. Only then ask Chairs to refresh — and only laptops showing **0 unsynced**.

Rollback changes the application only. It never changes the database or anything saved on laptops.

**Where are the fallback documents?**
- Printed per committee: delegate list, blank attendance sheet, blank speakers list, room sheet (QR + link).
- Resolutions: the delegates' Google Docs and the copies in the Approval Panel's Drive folder.
- Known-good card: in the operations folder.
- Device recovery files: only with the Executive / technical contact (they contain personal data — delete after recovery).

**After any incident:** write down time, room, what happened, what was done.
