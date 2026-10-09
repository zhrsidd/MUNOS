# Staff rehearsal — 40 minutes, no load test

Goal: **procedural familiarity**. Every person performs each step themselves once, on the development system, so that on conference day nothing is new. This is **not** a performance test: no scripts, no simulated users, nothing that needs the Supabase upgrade. (The performance rehearsal is separate and happens in conference week: [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md).)

Follow the [conference runbook](../CONFERENCE_RUNBOOK.md); this plan says which part to practise when.

## People and devices

| Who | Device | Notes |
| --- | --- | --- |
| **Executive** (leads the session) | laptop | Also reads out each step and keeps time |
| **Approval Panel** | laptop | |
| **Admins** | laptop | |
| **Chair A** | laptop | committee **X** |
| **Chair B** | laptop | the **same** committee **X** (two Chair laptops in one room, as on the day) |
| Delegate phone | any phone on **mobile data** | the Admins' or Approval's own phone is fine; never signs in |
| Spare | Chair B's laptop in a **new browser profile** | used for the replacement-device step |

Optional observer: technical contact (recommended for the first run).

## Prepared beforehand (technical contact, 15 minutes, the day before)

- [ ] The current `main` Preview URL and a Vercel **share link** for it (Preview deployments are behind Vercel Authentication). Write it on the whiteboard.
- [ ] Executive device prepared with an Executive code for the development conference (an existing Executive issues one in Access codes; a brand-new conference uses [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md)).
- [ ] Committee **X** chosen (has delegates; no resolution In Debate). Note its code.
- [ ] Executive has created codes in **Access codes** for: Chair · X, Approval Panel, Admins (expiry: tomorrow). Codes written on separate slips, one per person.
- [ ] Resolution link and amendment link exist for X (Executive → Resolution links / Amendment links). Sheets printed or open on a screen.
- [ ] A test Google Doc shared **Anyone with the link → Editor**, link ready on the delegate phone.
- [ ] Everyone uses a normal (not private) browser window.

## Running order

### 1. Code login — 5 min (everyone)

Runbook: *Staff device setup*, steps 1–4.

- [ ] Each person opens the share link → **Enter staff access code** → types their code → **Open staff workspace**.
- [ ] Check the strip at the top shows the right role. Chairs A and B: **Select committee** shows X.
- [ ] Executive reads out one wrong-code attempt on purpose (Chair B types one wrong character): *"That code is invalid or expired…"*. Then the right code.

### 2. Session selection — 3 min (Executive, Chairs)

- [ ] Executive → **Sessions** → **+ Add session** → name "Rehearsal", start now, Qatar time → **Create for all committees**.
- [ ] Chair A → top bar → **Current session** → "Rehearsal". Chair B sees the same current session after clicking into the window.

### 3. Attendance, speakers, POIs — 5 min (Chairs)

- [ ] Chair A → **Roll call**: mark five delegates **Present & Voting**, one **Absent**.
- [ ] Chair A → **Debate** → **Debate order**: **Add delegate** → **+ Queue** for three delegates → reorder with ↑/↓ → **Next speaker · ‹Country›** (always position 1) → **▶ Start timer** → **Ⅱ Pause** → score a configured speech value (e.g. **+1**) → **Finish · return floor to Chair**. The next speaker does not start automatically.
- [ ] Chair B → **Points of information**: choose an allowance → **Add to POI queue** for two delegates → **Next POI · ‹Country›** (records nothing yet) → after the question, choose a configured POI value (e.g. **+1**) → the next POI can now be recognized.
- [ ] Both Chairs see each other's changes within a minute (click into the window to refresh).

### 4. Resolution QR → Approval → Admins → debate — 7 min

- [ ] **Phone:** scan the resolution QR for X (mobile data) → choose delegation → paste the Google Doc link → **Submit resolution** → *"Resolution received"*.
- [ ] **Chair A** → **Documents** → *Delegate submissions* → open the Google Doc → **Submit to Approval**.
- [ ] **Approval** → **Review inbox** → **Start review** → **✓ Approve resolution**.
- [ ] **Admins** → **Print queue** → **✓ Mark printed**.
- [ ] **Chair A** → **Documents** → the resolution → **Open debate →**.

### 5. Amendment QR and a passed amendment — 5 min

- [ ] **Phone:** scan the amendment QR for X → delegation → **Add** → clause "1" → exact wording → tick the confirmation → **Submit amendment** → *"Amendment received"*.
- [ ] **Chair A** → **Amendments** → **Accept for debate** → **Start amendment debate** → **Passed**.
- [ ] Chair A reads the reminder *"Apply the passed amendment to the working Google Doc."* and types the amendment into the Google Doc by hand.
- [ ] Phone: submit a second amendment → Chair B → **Rule out**.

### 6. Offline Chair action, reconnect, and a "needs review" (PT409) — 7 min

Chair A does every step on their own laptop; the Executive watches.

- [ ] **Chair A:** turn Wi-Fi off. The strip says *"Internet unavailable"*. Mark delegate **D** → **Absent**, **then** add one speaker to the queue (order matters). The strip shows *"2 changes saved on this device…"*. Refresh the page: the Chair Console still opens with those changes.
- [ ] **Chair B** (online): mark the **same** delegate **D** → **Present**.
- [ ] **Chair A:** Wi-Fi on. The attendance change for D turns **RED "1 change needs review"** (Chair B changed D first) and the **speaker added after it waits** — Chair B does not see it yet. Point out: *nothing is lost, and the laptop is holding back its later work*.
- [ ] **Chair A:** Chair Console sidebar → **System health** (`/chair/health`) → item *"Review saved attendance change"*.
- [ ] **Chair A:** **Export device recovery file** (the dismiss button is disabled until this is done) → a file downloads.
- [ ] **Chair A:** Roll call → look at D's current value (Present, from Chair B).
- [ ] **Chair A:** back in System health → **Keep conference value · dismiss exported action** → confirm.
- [ ] **Chair A:** within a minute the strip is GREEN, 0 unsynced, and **the waiting speaker appears on Chair B's queue** — the later work resumed. Decide with Chair B whether D is present and enter it once.
- [ ] Executive: remind everyone — **never clear browser storage while work is pending**.

### 7. Recovery export — 2 min (every staff device)

- [ ] Approval, Admins, Chair B and the Executive: sidebar → **System health** (`/approval/health`, `/logistics/health`, `/chair/health`, `/admin/health`) → **Export device recovery file** → a file downloads. The Executive collects and deletes all rehearsal files (they contain delegate details).

### 8. Access-code rotation and replacement device — 5 min

- [ ] **Executive** → **Access codes** → **Chair · X** → **Rotate** → copy the new code → **Done**.
- [ ] Chair A's existing laptop keeps working (rotation does not sign out prepared devices).
- [ ] **Spare** (Chair B's laptop, new browser profile): enter the **old** code → *"invalid or expired"*. Enter the **new** code → select X → check Current session, roll call and queue match what was synced. Continue as Chair on the spare.

### 9. Wrap-up and revocation — 1 min + debrief

- [ ] Chair A: close the rehearsal resolution (Voting → record ballots → **Close voting**, or withdraw it) so the amendment form closes. Both Chair devices: 0 unsynced.
- [ ] Executive → **Access codes** → **Revoke** on Chair · X with **Also revoke devices using this code** → the Chair laptops show "Conference access" at their next access check (within about a minute, or on refresh). Point out the **Export saved changes** / **Sign out after recovery export** buttons on that screen — the safe way off a revoked device that still holds work.
- [ ] Executive: revoke the Approval Panel and Admins rehearsal codes; archive the "Rehearsal" session.
- [ ] Debrief (10 min, not counted): what was confusing? Which labels didn't match the runbook? Write findings in the runbook margin and send them to the Executive lead.

## What "done" looks like

Every participant has personally: entered a code, found their role/committee, recorded something, seen YELLOW offline and back to GREEN, seen a RED "needs review" resolved without loss, exported a recovery file, and (Chairs) used both QR flows end to end. The Executive has rotated a code, moved a Chair to a replacement device, and revoked codes with device revocation.

Rehearsal records stay in the development test conference. Do not run this on Production.
