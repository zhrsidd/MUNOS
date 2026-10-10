# Conference runbook

For the Executive team, Chairs, the Approval Panel and Admins. **No technical knowledge needed.** Print it and keep a copy in the operations room and one per committee room.

- One-page emergency sheet: [docs/EMERGENCY_RECOVERY.md](docs/EMERGENCY_RECOVERY.md)
- Release gates (technical lead): [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)
- Practice session for staff: [docs/STAFF_REHEARSAL.md](docs/STAFF_REHEARSAL.md)
- Technical detail for the technical contact: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

| Role | Name | Phone |
| --- | --- | --- |
| Executive (lead) | | |
| Executive (deputy) | | |
| Technical contact (Vercel + Supabase access) | | |
| School IT / Wi-Fi | | |

Attach: the **known-good release card** (from [docs/RELEASES.md](docs/RELEASES.md)).

> **Status:** the conference system has passed testing on the development system. The conference (Production) system does not exist yet; it is created in conference week after the checks in the release checklist. Until then, everything in this runbook can be practised on the development system only.

## The golden rules

1. **Never clear browser data, "reset" the browser, use a private/incognito window, or swap laptops on a device that shows unsynced changes or "needs review".** Unsynced work lives only on that laptop.
2. **Never sign out to "fix" something.** Signing out is only for the end of the conference, or when the Executive asks.
3. **If a screen turns RED, stop recording on that device and call the Executive.** YELLOW means carry on.
4. **One record, one place.** If you go to paper, the paper is the record until one person types it in afterwards. Never record the same thing in two places at once.
5. **Access codes are passwords.** Never post them in a group chat, on a slide, or on a printed sheet in a room.

## How the pieces fit together

- **Conference OS** is the record for attendance, speakers, timer, participation, votes, the resolution workflow, amendments, sessions and group photos. Only staff use it: Chairs, Approval Panel, Admins, Executive.
- **Delegates never sign in.** They only use two QR forms on their phones: the **resolution QR** (to submit their Google Doc) and the **amendment QR** (to propose an amendment while a resolution is in debate).
- **Google Docs** hold the resolution text. Delegates write it; Chairs edit it — including typing in passed amendments **by hand**. Conference OS never changes a Google Doc.
- **Google Drive** holds the Approval Panel's folder, where Chairs put a copy of each resolution.

```
Resolution:  delegate writes Google Doc → resolution QR → Chair: Documents → Submit to Approval
             → Approval Panel: approve → Admins: Mark printed → Chair: Open debate → Voting → result
Amendment:   resolution is In Debate → delegate scans amendment QR → Chair: Amendments → Accept for debate
             → Start amendment debate → Passed / Failed → if Passed, Chair edits the Google Doc
```

## Who uses what

| Staff role | Workspace in the app | What they do |
| --- | --- | --- |
| **Chair** (one code per committee) | *Chair Console*: Debate, Roll call, Participation, Documents, Amendments, Voting, Group photos | Runs the committee |
| **Approval Panel** | *Approval Panel*: Review inbox | Reviews and approves resolutions |
| **Admins** | *Admins*: Print queue | Prints approved resolutions, marks them printed |
| **Executive** | *Executive*: Overview, Committees, Sessions, Access codes, Resolution links, Amendment links, System health … | Sets everything up, watches health, handles incidents |

## The three colours

Every screen shows a strip at the top when things are not GREEN. Full detail: **Executive → System health**.

| Colour | What it means | What to do |
| --- | --- | --- |
| **GREEN** | Everything normal. | Carry on. |
| **YELLOW** | Something is slow or temporarily unavailable (for example *"Internet unavailable"*, *"Live updates temporarily unavailable"*, *"Connection is slow"*, *"Syncing changes"*). The committee can continue; changes are kept on the device and sync automatically. | Carry on. Keep the laptop open and on Wi-Fi. If it lasts 15 minutes, call the Executive. |
| **RED** | This device needs a person: *"N changes need review"*, *"Changes are waiting too long"* (over 15 minutes), *"This device cannot save changes"* or *"Not connected to the conference"*. | Stop recording on that device. Call the Executive. Do not clear the browser, sign out or swap laptops. |

---

## BEFORE THE CONFERENCE

Owner: Executive (with the technical contact). Start one week before; finish by **48 hours before** (the freeze).

### Conference data — Executive

- [ ] **Committees** (Executive → Committees): every committee has the right code, name and room. Remove test committees (*Delete* only works for unused ones; otherwise *Archive* — see the warning below).
- [ ] **Delegates and schools** (Executive → Delegates, Schools): every school exists once; spot-check five delegates per committee (country, school, committee).
- [ ] **Staff** (Executive → Chairs & staff): every Chair is assigned to the right committee with an email they actually read.
- [ ] **Session schedule** (Executive → **Sessions**): click **+ Add session** for each conference session (for example "Session 1", start and end in Qatar time) → **Create for all committees**. Each session is created in every active committee. Check two committees show the full list.
- [ ] **Group photos** (Executive → Group photos): every school has its slot, time and place.

> **Archive is one-way.** *Archive* on a committee hides it from Chairs **and immediately cancels that committee's Chair access codes and Chair devices**. There is no "unarchive" button. Archive only test committees, and never during the conference.

### Access codes — Executive

Executive → **Access codes** ("Staff access codes"). (On a brand-new conference project, the technical lead first gives the first Executive a one-time bootstrap code: [docs/FIRST_EXECUTIVE_BOOTSTRAP.md](docs/FIRST_EXECUTIVE_BOOTSTRAP.md).) One code per scope:

- [ ] **Chair · <committee>** — one for each committee.
- [ ] **Approval Panel** — one for the panel.
- [ ] **Admins** — one for the print/admin team.
- [ ] **Executive** — one for the Executive team.

For each: set **New code expires** to the end of the conference (Qatar time) → **Create** (or **Rotate** if one exists). The dialog "*… copy this code now*" shows the code **once**: **Copy code**, store it in the Executive password manager or a sealed envelope per committee, then **Done**. It cannot be shown again; if lost, *Rotate* to get a new one (devices already prepared keep working).

- [ ] Test codes from rehearsals are **Revoked**.
- [ ] Codes are handed to people privately — never displayed in a room or sent to a group chat.

### QR sheets — Executive / Admins

- [ ] **Resolution QR** (Executive → **Resolution links**, page "Submission links"): every committee has a link → **Print sheet**. Also save each sheet as PDF in the operations folder.
- [ ] **Amendment QR** (Executive → **Amendment links**): **Create N missing links** → **Print sheet** for every committee; save as PDF too. The amendment QR stays the same all conference; it only accepts amendments while a resolution is *In Debate*.
- [ ] Each committee room gets both sheets. Spare copies stay in the operations room.
- [ ] Test each committee once from a phone **on mobile data**: resolution QR opens the committee's form; amendment QR says *"Amendments are not currently open in this committee."* (correct when nothing is in debate).

### Google Docs and Drive — Executive with every Chair

- [ ] Delegations told in advance: write in Google Docs, **Share → Anyone with the link → Editor**, submit the link on the resolution QR. No login.
- [ ] Each Chair opens a test delegate Doc on their Chair laptop and can edit it.
- [ ] Each Chair knows the Approval Panel's Drive folder and how to copy a Doc into it (File → Make a copy → choose the folder).
- [ ] Each Chair has practised typing a passed amendment into a Google Doc (the app reminds them; it never edits the Doc).

### Devices and fallback — Executive

- [ ] Every staff device prepared (see **Staff device setup** below), including **two spare Chair laptops**.
- [ ] Every device: date and time set **automatically** (photo reminders use the device clock).
- [ ] Every device uses a **normal** browser window (not private/incognito) and a browser profile nobody else uses. Note on each laptop: *"Conference device — do not clear browser data."*
- [ ] **Do not clear browser storage** on any prepared device from now until the end of the conference.
- [ ] **Recovery practised:** on one prepared Chair laptop and the Executive laptop, sidebar → **System health** → **Export device recovery file** downloads a file. Delete the test files.
- [ ] **Paper fallback per committee** (in a labelled envelope, for emergencies only): delegate list, blank attendance sheet, blank speakers list, **blank amendment slips** (delegation, resolution, Add/Strike/Replace, clause, exact wording), **vote-tally sheets** (for / against / abstain per vote), a **resolution intake log** (time, delegation, title, how received), both QR sheets, and this runbook's *During the conference* page.
- [ ] Wi-Fi tested in every committee room (System health GREEN). Note weak rooms.

---

## STAFF DEVICE SETUP

Do this the day before, on the school Wi-Fi, one device at a time (preparing many devices in the same few minutes from one network can hit a sign-in limit). Allow 5 minutes per device.

1. **Open the app** in a normal browser window: the conference address from the Executive.
2. You see **"Enter staff access code"**. Type the code into **Staff access code** → **Open staff workspace**.
   - *"That code is invalid or expired"* → check it with the Executive (codes are 24 characters; dashes don't matter).
   - *"Too many attempts. Please wait 10 minutes…"* → wait; don't keep trying.
3. **Confirm the role.** The strip at the top shows your role (*Chair*, *Approval Panel*, *Admins* or *Executive*). Chairs: the top-bar **Select committee** list shows your committee (`CODE · Room`). Wrong role or committee → tell the Executive now.
4. **Confirm the device is prepared.** Status strip gone (GREEN). Chairs: open Debate, Roll call, Documents and Amendments once. Everyone: open **System health** from the sidebar once — it shows GREEN.
5. **Test offline once** (Chairs): turn Wi-Fi off → refresh the page → the Chair Console still opens and the strip says *"Internet unavailable"* → mark one delegate present → turn Wi-Fi on → within a minute the strip disappears (GREEN). Undo the test mark.
6. **Test recovery export once:** sidebar → **System health** → **Export device recovery file** → a file downloads. Give it to the Executive to delete.
7. Close the lid. **Do not sign out.** The device stays prepared.

**Spare laptops:** prepare them like Chair laptops with the Chair code of a committee, then leave them closed. On the day, a spare can join any committee by entering that committee's Chair code.

**Prepared devices stay usable offline for up to 48 hours** after their last connection (or until their code expires). Connect every device to Wi-Fi at least once a day.

### What not to do on conference day

- Don't clear browser data, cookies or "site data". Don't use private/incognito windows.
- Don't sign out, switch browser profiles or reinstall the browser.
- Don't open the same committee's Chair Console in two tabs on one laptop.
- Don't share access codes or take photos of them.
- Don't update the laptop's operating system or browser during sessions.

---

## DURING THE CONFERENCE

### Every morning (45 minutes before sessions)

- [ ] Executive: System health **GREEN**, *Version* matches the known-good card.
- [ ] Each Chair: select the committee, then set **Current session** (top bar) to today's first session. Every Chair device in that committee shares this choice.
- [ ] Each Chair laptop: strip GREEN, **0 unsynced**.
- [ ] One committee: mark a delegate present, add a speaker, start/stop the timer (undo afterwards).

### Using the amendment QR

1. The resolution must be **In Debate** (Chair → Documents → **Open debate →**). The amendment form opens automatically.
2. Delegates scan the amendment QR in the room, choose their delegation, type (Add / Strike / Replace), clause and **exact wording**, tick the confirmation → **Submit amendment** → they see *"Amendment received"* and a reference.
3. Chair → **Amendments**: each submission appears as *Submitted*. **Accept for debate** (or **Rule out** / **Withdraw**).
4. **Start amendment debate** — only one amendment can be in debate at a time.
5. After the vote: **Passed** or **Failed**.
6. **If Passed: the Chair edits the working Google Doc by hand** (the app shows *"Apply the passed amendment to the working Google Doc."*). Conference OS does not change the Doc.
7. When the resolution's debate closes, the amendment form closes again by itself.

If a delegate sees *"This amendment link is not valid"*, the Executive replaced the link: use the newly printed sheet.

### Situations

| Situation | What to do |
| --- | --- |
| **Wi-Fi drops (one room or everywhere)** | Keep chairing. Attendance, speakers, timer, participation, votes and amendment decisions save on the laptop (YELLOW *"Internet unavailable — N changes saved on this device"*) and sync when Wi-Fi returns. Don't close the laptop or switch devices. Delegates keep writing in Google Docs; phones on mobile data can still use both QR forms. After 15 minutes the strip turns RED as a reminder — still safe, keep it open, tell the Executive. |
| **"Live updates temporarily unavailable"** (Realtime) | Nothing to do. Everything still saves. Other screens refresh at least once a minute and whenever you click back into the window. |
| **RED "N changes need review"** (a conflict — technically a *PT409*) | Another device changed the same thing first, the session was archived, or access changed. **Nothing is lost**, but that laptop now holds back its later changes. Tell the Executive and clear it on that laptop straight away (*Handling "needs review"* below). |
| **A Chair laptop dies or is lost** | Follow *Moving to a replacement device* below. |
| **Two Chairs see different things** | Each clicks into the window once (refresh happens on focus). Still different after a minute → call the Executive. |
| **Wrong current session selected** | Chair → top bar → **Current session** → pick the right one. Records already made stay in the session they were made in; tell the Executive so they can note it. |
| **A session was archived by mistake** | Don't create a duplicate. Call the Executive. Records made in it are kept; Chairs select another current session. See *Incidents*. |
| **Chair can't open a delegate's Google Doc** | Chair → Documents → **Can't access** on that submission; ask the delegation to set *Anyone with the link → Editor*. When it opens, **Access fixed**. |
| **Resolution QR / amendment QR doesn't work** | Use the printed link under the QR, or Chair → Documents → *Open submission page* / Chair → Amendments → *Open amendment form*. *"not valid"* means the Executive replaced it — print the new sheet. |
| **Photo reminder didn't appear** | Check the laptop clock is automatic. Chair → Group photos lists the slots. |

### Handling "needs review"

A change that needs review **holds back every later change recorded on that device** until it is cleared, so clear it promptly. Do it **on the device that shows it** (don't move it). Anyone on that device can do it with the Executive watching:

1. Open **System health** from the sidebar of your workspace (Chair: *System health* in the Chair Console). Each item reads *"Review saved … change"*.
2. **Export device recovery file** first (the dismiss button stays disabled until you do).
3. Read the item's message and check the current value in the app (for example the delegate's attendance).
4. **Keep conference value · dismiss exported action** → confirm.
5. Check the strip: the later changes that were waiting now sync (GREEN, 0 unsynced).
6. If the dismissed change is still needed, enter it again normally.
7. Give the recovery file to the Executive; delete it once the day is reconciled (it contains delegate details).

There is no "force my version" button — by design. **Never clear browser storage while changes are waiting** — that destroys them.

### System health on every device

| Workspace | System health address | In the app |
| --- | --- | --- |
| Chair | `/chair/health` | Chair Console sidebar → *System health* |
| Approval Panel | `/approval/health` | sidebar → *System health* |
| Admins | `/logistics/health` | sidebar → *System health* |
| Executive | `/admin/health` | Executive sidebar → *System health* |

Each shows **that device's** state — unsynced changes, items needing review, **Export device recovery file** — and only that device's: another laptop never shows or clears them. Each role opens only its own address: a Chair cannot open the Executive one (it returns to the Chair Console). A **prepared** device (opened online once since the last update) can also open or reload its own System health page **while offline**, so a recovery export works without a network. Offline, the app opens only from what is already saved on the device; anything that needs the conference database waits until it reconnects.

### Moving to a replacement device

1. Take a **spare laptop**. If it shows the code screen, enter the **Chair code for this committee** (from the Executive).
2. Select the committee and check **Current session**, roll call and the speaker queue. Only changes the old laptop had **already synced** are there.
3. Strip GREEN, 0 unsynced → continue chairing.
4. **The old laptop:** if it can be revived, give it to the Executive **before connecting it to Wi-Fi**. On it, open the workspace and then **System health** from the sidebar → **Export device recovery file**. The technical contact then decides whether to let it sync (avoids recording things twice). If its access was revoked, the code screen offers **Export saved changes** then **Sign out after recovery export** — export first.
5. If the old laptop is gone for good, its unsynced changes are lost: re-enter anything important and note it in the incident log. If it was **lost or stolen**, see *Incidents*.

---

## AFTER EACH DAY

- [ ] Every staff device: strip GREEN, **0 unsynced**. A device with unsynced changes stays open and on Wi-Fi until it syncs.
- [ ] Every device: **0 "needs review"**. Anything left: Executive handles it (export → dismiss) and keeps the file.
- [ ] Executive → Overview / Documents: nothing stuck in *Delegate submissions*; Approval inbox and Print queue understood; no amendment left *In Debate*.
- [ ] Each Chair: close any resolution still *In Debate* if its debate is finished (so the amendment form closes overnight).
- [ ] **Sessions:** do not archive today's sessions unless the Executive decides to; archiving is not required at the end of a day. Never archive a session that still has a resolution in debate (the app refuses).
- [ ] Recovery files from the day: reconciled, then deleted.
- [ ] Tomorrow's sessions and group photos correct.
- [ ] **Do not clear browser storage on any device.** That happens only after the conference, once the Executive confirms every device is at 0 unsynced.
- [ ] Executive: System health GREEN. Write down any incidents.

---

## INCIDENTS

Write every incident down: time, room, what happened, what was done.

| Incident | What to do |
| --- | --- |
| **Database unavailable** (System health: *Conference database* down on every device; Supabase outage) | Open screens keep saving on their devices — don't close or refresh them. QR forms say *"temporarily unavailable"* — delegates wait or give the Chair a copy. Technical contact checks [status.supabase.com](https://status.supabase.com/). If it lasts over 30 minutes, go to paper (below). |
| **App not loading** (Vercel unavailable) | Laptops already open keep working — don't close them. Check on a phone with mobile data. Technical contact checks [vercel-status.com](https://www.vercel-status.com/). If a change was deployed recently, the technical contact returns to the known-good release ([emergency sheet](docs/EMERGENCY_RECOVERY.md)). |
| **Live updates unavailable** (Realtime) | Nothing to do (YELLOW). Screens refresh at least every minute. |
| **Google Docs / Drive unavailable** | Conference OS keeps working: roll call, speakers, timer, participation, votes, amendments. Only opening, editing or copying Docs waits. Vote on resolutions already printed; type passed amendments into the Doc once Google is back (note them on paper meanwhile). |
| **A staff access code leaked** | Executive → Access codes → that scope → **Rotate** (old code stops working for new devices) → hand the new code privately. If unknown devices may already have used it: **Revoke** with **Also revoke devices using this code**, then re-prepare the real devices with the new code (their unsynced work stays on them — export before signing out). |
| **Wrong committee archived** | Stop. The committee disappeared from Chair laptops and its **Chair codes and devices were cancelled**. Don't create a replacement committee. Call the technical contact: restoring needs a database fix (there is no unarchive button). Meanwhile that committee runs on paper. After the fix, the Executive issues a new Chair code and the Chairs enter it. |
| **Lost or stolen laptop** | Executive → Access codes → that laptop's scope → **Revoke** with **Also revoke devices using this code** → **Rotate** to create a new code → prepare the replacement and the other devices of that scope again. Its unsynced work is lost; re-enter from notes. |
| **QR link leaked or abused** (spam submissions) | Executive → Resolution links or Amendment links → **Replace** (the old QR stops immediately) → print and post the new sheet. Chairs **Rule out** spam amendments. Built-in limits also stop floods (20 per link per 10 minutes; 5 amendments per delegation per 10 minutes). |
| **Offline device with unsent work** (can't reconnect, or its access expired) | Keep it powered and do not sign out. Sidebar → **System health** → **Export device recovery file** (or, if its access expired, the code screen's **Export saved changes**). The technical contact decides how the work is entered. Only then **Sign out after recovery export**. |
| **Paper fallback** (emergency only: Conference OS unusable for a long time) | Each committee uses its envelope: attendance sheet, speakers list, blank amendment slips (delegates write the exact wording; the Chair keeps them in order), vote-tally sheets, and the resolution intake log. One person per committee enters the paper record afterwards, once. Don't start a spreadsheet. |
