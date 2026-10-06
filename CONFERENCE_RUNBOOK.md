# Conference runbook

For conference organizers. No technical knowledge needed. Print it and keep it in the operations room.
One-page emergency sheet: [docs/EMERGENCY_RECOVERY.md](docs/EMERGENCY_RECOVERY.md). Technical detail for the technical contact: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

| Role | Name | Phone |
| --- | --- | --- |
| Executive (lead) | | |
| Executive (deputy) | | |
| Technical contact (Vercel + Supabase access) | | |
| School IT / Wi-Fi | | |

Attach: the **known-good release card** (from `docs/RELEASES.md`).

**Development status:** this is a preparation runbook, not evidence of production readiness. Complete the release gates in [docs/INTEGRATION_REVIEW.md](docs/INTEGRATION_REVIEW.md) and the rehearsal in [docs/STAGING_REHEARSAL.md](docs/STAGING_REHEARSAL.md) before conference use. Conference OS is staff software (Chair, Approval, Admins, Executive); delegates only use the QR form and never sign in.

## How it fits together

- **Conference OS** = who is present, speakers, timer, participation, votes, resolution workflow (submitted → with Chair → Approval → printed → debate → result), group photos. It is the record for all of these.
- **Google Docs** = the resolution text. Delegates write it; Chairs edit it and type in passed amendments. Conference OS never edits the text.
- **Google Drive** = the Approval Panel's folder where Chairs put a copy of each resolution (by hand, for now).

```
Delegate:  write Google Doc → Share: Anyone with the link → Editor (or share with a Chair) → scan QR → paste link → Submit
Chair:     Documents → Delegate submissions → Open Google Doc → review → copy into Approval folder → Submit to Approval
Approval:  review the copy → approve → Admins print → debate → vote
```

## The three colours

System health (**Executive → System health**) shows one colour. Every screen shows a strip at the top when it is not GREEN.

| | Meaning | Do |
| --- | --- | --- |
| **GREEN** | Everything normal. | Carry on. |
| **YELLOW** | Something is slow or unavailable, but the committee can continue. Changes are kept on the device and sync automatically. | Carry on. Don't close the laptop or clear the browser. If it lasts 15 minutes, use the matching procedure below. |
| **RED** | Action needed: this device can't save, changes need review, changes have waited over 15 minutes, or the device isn't connected to the conference. | Stop recording on that device. Call the Executive. Don't clear the browser or swap laptops. |

## Before the conference (by 48 hours before)

**Release and systems** (technical contact)
- [ ] System health → *Running version* matches the known-good card. Production is frozen from 48 hours before opening.
- [ ] System health is GREEN. Supabase dashboard shows the production project healthy and a backup exists.
- [ ] Rollback rehearsed once on staging; the person who will do it has Vercel access.

**Conference data** (Executive)
- [ ] Committees: right code, name and room.
- [ ] Schools: every school exists once (no near-duplicates).
- [ ] Delegates: spot-check five per committee (country, school, committee).
- [ ] Sessions: **Executive → Schedule import**, preview, confirm. Each committee shows the right sessions and times.
- [ ] Group photos: **Executive → Group photos** — every school has its slot, time and place; affected committees look right.

**Access** (technical contact grants it; there is no access-code login yet)
- [ ] Every Chair laptop opens its committee in Chair Console.
- [ ] Approval Panel, Admins and Executive devices open their workspaces.
- [ ] **Two spare laptops** prepared with Chair access to *every* committee, signed in, Chair Console opened once.

**Resolutions**
- [ ] Tell delegations in advance (briefing / handbook): write in Google Docs, set **Share → Anyone with the link → Editor**, then submit the link on the committee QR page. No login.
- [ ] **Executive → Chairs & staff**: every Chair is assigned to the right committee with a contact email they really use. The QR form lists these assigned Chairs as the fallback for schools that block link sharing (contacts are not app access; no committee mailboxes).
- [ ] **Executive → Submission links**: every committee has a link; its *Assigned Chair contacts* column is complete.
- [ ] For each committee: on a phone, scan the QR, submit a test Google Doc link (Doc set to *Anyone with the link → Editor*). Chair → Documents → *Delegate submissions* shows it; *Open Google Doc* works on the Chair laptop; Chair copies it into the Approval folder and clicks *Submit to Approval*; it appears in Approval; Approval approves; Admins mark it printed.
- [ ] Each Chair knows the Approval Panel's Drive folder and how to copy a Google Doc into it (File → Make a copy → choose the folder).
- [ ] Print the room sheets (Chair Console → Documents → *Print room sheet*).

**Rooms and devices**
- [ ] Wi-Fi tested in every committee room (System health GREEN). Note weak rooms.
- [ ] Every conference device has **date and time set automatically** (photo reminders use the device clock).
- [ ] Each Chair laptop: open Chair Console and Group photos, then Wi-Fi off → refresh → Chair Console still opens → Wi-Fi on → GREEN, 0 unsynced.

**Fallback**
- [ ] Per committee, printed: delegate list, blank attendance sheet, blank speakers list, room sheet.
- [ ] Approval folder copies are readable by the Executive (so documents are reachable even if Conference OS is down).

## Every conference morning (45 minutes before sessions)

- [ ] Executive opens System health: **GREEN**, version matches the card.
- [ ] Each Chair opens their committee and sets the committee's **Current session** (shared by every Chair device in that committee; the app only suggests by time).
- [ ] One committee: mark a delegate present, add a speaker, record one participation point, start/stop the timer (undo the point afterwards).
- [ ] One test submission by QR → Chair opens the Google Doc → *Submit to Approval* → Approval approves → Admins mark printed.
- [ ] Today's group photos look right (Executive → Group photos).
- [ ] Every Chair laptop: sidebar GREEN / "Synced" and **0 unsynced**. Fix anything else before sessions start.

- [ ] Security Council: check the configured permanent members; rehearse one substantive vote with a veto and one procedural vote (no veto).

Not available yet (do not test): amendment flow.

## During the conference

| Situation | What to do |
| --- | --- |
| **A Chair loses internet** | Keep chairing. Attendance, speakers, timer, participation and votes save on the laptop (YELLOW) and sync when back online. Don't close the laptop or switch devices. |
| **School Wi-Fi fails everywhere** | Same as above in every room. Delegates keep writing in Google Docs and submit links when Wi-Fi returns. If it lasts long, phones on mobile data can still submit. |
| **Conference OS page won't load** | Laptops already open keep working — don't close them. Check on a phone with mobile data. Call the technical contact. See the emergency sheet. |
| **Database problem** (System health: "Conference database unreachable" on all devices) | Open screens keep saving on their devices. QR submissions stop until it returns. Don't refresh repeatedly. Technical contact checks [status.supabase.com](https://status.supabase.com/). |
| **Live updates disconnected** (YELLOW) | Nothing to do. Screens refresh at least every minute and when a page is reopened. Photo reminders still appear. |
| **Google Docs / Drive down** | Conference OS keeps working (see below). Documents can't be opened or copied until Google recovers. |
| **Chair can't open a submitted Google Doc** | Chair clicks *Can't access* on it and asks the delegation to set **Anyone with the link → Editor**, or to share it directly with the Chair as **Editor** (if their school blocks link sharing). When it opens, click *Access fixed*. |
| **Delegate forgot to share the Doc** | Same as above. Their submission is safe; only access is missing. |
| **Submission fails** | "Not received" → tap Submit again (safe, no duplicates). "Not a Google Docs link" → copy the link from the Doc's *Share* button. Still failing → see "file fallback". |
| **QR code doesn't work** | Use the link printed under the QR, or open Chair Console → Documents → *Submission QR*. If the link says "not valid", the Executive replaced it — print the new room sheet. |
| **File fallback needed** | On the submission page tap *Upload a file instead* (PDF or Word, up to 4 MB). If uploads are also unavailable, the delegate gives the file to the Chair and submits later. |
| **A device shows unsynced changes** | Normal while offline. Keep it open and connected. If RED for over 15 minutes, call the Executive. Never clear the browser. |
| **A Chair laptop dies** | Follow *Chair device failure* below. |
| **Photo reminder didn't appear** | Check the laptop's clock is automatic and correct. Chair Console → Group photos lists the committee's slots. The Executive can see who acknowledged in Executive → Group photos and send a runner if needed. |

### Google Docs/Drive down vs Conference OS down

**Google Docs/Drive down, Conference OS working:** attendance, speakers, timer, participation (including POI points), votes and the resolution workflow all continue. Only opening, editing or copying documents waits. Vote on resolutions already printed; pause document editing until Google recovers.

**Conference OS down, Google working:** Chairs use the Approval-folder copies and the delegates' Google Docs to keep debate going, and record attendance, speakers and votes **on paper**. Don't create a parallel digital record (no new spreadsheet). When Conference OS returns, one person per committee enters the paper record.

### Chair device failure

1. Take a **spare laptop** (prepared with access to every committee). Open Conference OS → Chair Console.
2. Choose the committee in the top bar and check the **Current session**.
3. Check roll call, the speaker queue and recent participation. Only changes the old laptop had **already synced** are there.
4. The status strip must be GREEN with 0 unsynced. Continue chairing.

If the old laptop had **unsynced changes**: they exist only on that laptop. They do not transfer.
- If it can be revived, give it to the Executive. **Before connecting it to Wi-Fi**, open System health on it (`/admin/health`) and **Export device recovery file**, then let the technical contact decide whether to let it sync. This avoids the same thing being recorded twice.
- If it cannot be revived, those changes are lost. Re-enter anything important on the new laptop and note it in the incident log.

## End of each day

- [ ] Every laptop: GREEN, **0 unsynced**. Leave any laptop with unsynced changes open and connected until it syncs.
- [ ] Any RED "need review": Executive opens System health on that device, exports the recovery file, then resolves it.
- [ ] Resolution states look right: nothing stuck in *Delegate submissions*; Approval inbox and print queue understood.
- [ ] The day's important Google Docs and Approval copies open for the Executive.
- [ ] Technical contact confirms a database backup exists for today.
- [ ] Tomorrow's sessions and group-photo slots are correct (cancelled slots marked cancelled).
- [ ] Final check: System health GREEN on the Executive device. Write down any incidents.

## Emergency

- **Return to the known-good release, Supabase checks, broken deployment:** [docs/EMERGENCY_RECOVERY.md](docs/EMERGENCY_RECOVERY.md).
- **Paper fallback** (only if absolutely necessary): printed attendance sheet and speakers list; record times and names; one person enters them afterwards. Never record the same thing in two systems at once.
- **Emergency fix during the freeze:** only for something blocking the conference — small, tested, checked on a Preview first, with the known-good release ready for rollback ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#production-freeze)).

Planned, not yet available: automatic Approval-folder copies, PDF snapshots and Drive archive exports ([docs/GOOGLE_DRIVE_ARCHITECTURE.md](docs/GOOGLE_DRIVE_ARCHITECTURE.md)), access-code login, amendment tracking.
