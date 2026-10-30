# Session model: sessions are a schedule that labels records (contract draft v3)

**Status:** draft contract v3 with the owner-confirmed 5-minute lead (29 Oct 2026) and an implementation plan in §12, issued on the owner's instruction to implement from this document. Schema, RLS and sync changes still go through the review gates in `AGENTS.md`. Implementation is in progress on branch `claude/session-model`: phases 1, 2, 3 and the device protocol with a minimal review screen are done, see §12.13. Everything is unapplied and awaiting independent review. v2 (`4aa2e64`) answered the first review's four blockers; v3 answers the re-review's three remaining findings (uncertain timestamps must not authorise totals; offline roll-call time semantics; automation toggle versus existing overrides). Schema, RLS and sync-contract changes are shared-architecture work, serialised under one integration owner (see `AGENTS.md`) and cross-reviewed.

## 1. Decisions and their provenance

| # | Decision | Provenance |
|---|---|---|
| 1 | Sessions are a schedule display; the committee holds live state; the **server** stamps a session label on records; chairs never choose it | **Owner**, 19 Oct 2026: asked for sessions to become "more of a display of schedule rather than everything being tied to them"; "approve" |
| 2 | Only the Executive controls the schedule, lead times, overrides and automation | **Owner**, earlier in the session ("committee sessions should be ONLY changeable by the executive") |
| 3 | Lead time begins in the break; the next session's switch is configurable minutes before it begins | **Owner**: "lead time should begin in the breaks" |
| 4 | Overruns are allowed until the next session's switch time | **Owner**: "overruns are allowed to go as far as the beginning of next session lead time" |
| 5 | Automation is toggleable | **Owner**: "automation for session switching should be toggle able" |
| 6 | An offline action is labelled by the session whose window contains its device time | **Owner**: "offline actions … submitted if time on device matches that committee session's time as scheduled" |
| 7 | Queue and debate mode persist across sessions by default | **Owner**: "yes". The owner **also approved an optional auto-clear at session start**; it is **retained as approved but deferred scope**, not cancelled (§9) |
| 8 | Roll call is prompted at each session start, with an option to copy the last roll call | **Owner**: "yes with option to copy last sessions roll call" |
| 9 | Timers are local-only and not audited; the projector page is removed | **Owner**: timers "not necessary to audit and save"; projector: "6. Remove" |
| 10 | Amendments and votes belong to the resolution, not the session | Follows from decision 1; owner approved the restructure |
| 11 | Lead default 5 minutes; close grace 20 minutes | **Lead 5 minutes: confirmed by the owner, 29 Oct 2026** ("the previous 5 minute structure is ideal"). The previous session holds through the break and switches 5 minutes before the next session starts, never before the previous session ends. **Close grace 20 minutes: still proposed**, a parameter, not a rule |

## 2. Four labels for one record (resolves the "nearest session" contradiction)

A record has four distinct session fields. They are never merged or overwritten.

| Field | Meaning | Who sets it |
|---|---|---|
| `displayed_label` | What the device showed the chair when the action was recorded; evidence only, never authority | Device |
| `assigned_label` | The server's assignment from the schedule version in effect at the action's time (§3) | Server, at receipt |
| `reviewed_label` | An Executive correction, with reason and audit entry | Executive |
| `final_label` | `reviewed_label` if present, otherwise `assigned_label`; used by reports | Derived |

**Outside any window the label is null** (never "the nearest session") and the record is flagged `outside_schedule`.

## 3. Schedule model

**Versions.** Every change to a committee's sessions, lead times, close grace or automation settings is an immutable `schedule_version(id, committee, effective_from, changed_by, reason, windows…)`. `effective_from` is server time at publish.

**Effective-time rule.** A label is computed with the schedule version in effect at the action's time: the version with the greatest `effective_from` not later than it. A schedule edit takes effect at publish time and is **never retroactive**. Retroactive corrections are separate, audited, reviewed re-label actions (`reviewed_label`).

*Worked case:* a chair records at 12:24 offline. (a) The Executive published at 12:10 an edit moving the next switch from 12:25 to 12:20. The version in effect at 12:24 has the new switch, so the server assigns the **new** session; the device-observed label (old) is kept and the difference is flagged for review. (b) The Executive publishes the same edit at 12:30. The version in effect at 12:24 is the old one, so the server assigns the **old** session.

**Window rule.** For a committee's sessions `S1..Sn` and lead `L` (conference default, optional per-slot override):

- `switch(Sk) = max(start(Sk) − L, end(S(k−1)))`; for the first session of a day, `start(S1) − L`.
- `window(Sk) = [switch(Sk), switch(S(k+1)))`.
- Last session of a day: `window(Sn) = [switch(Sn), close)`, `close = min(Executive "close day", end(Sn) + grace, next local midnight)`.
- The day is the calendar day in the conference time zone (`CONFERENCE_TIMEZONE`). A window never crosses a day boundary.

**Validation at publish.** Reject: sessions of one committee that overlap; `start ≥ end`; negative lead or grace; identical starts. A rejected publish changes nothing.

**Overrides.** An override is an immutable log entry `(scope: committee | conference, session, set_by, set_at, expires_at)`.
- Precedence: a **committee** override beats a **conference** override; within one scope the later `set_at` wins.
- Expiry: with automation on, `expires_at` is the next scheduled switch (computed and stored at creation under the schedule version in effect, so history is stable). With automation off, an override has no scheduled expiry, but **no override ever crosses the next local midnight** (a window never crosses a day boundary).
- **Enabling automation ends every manual override in its scope at that moment.** The log appends an `ended` entry (`reason: automation_enabled`, `ended_at`) and never rewrites the original; history is interpreted from the log as it was. Disabling automation does not create an override. With automation off and no unexpired override, the committee has no session.
- An action is labelled by the override log and schedule versions **as they were at the action's time**, not as they are now.
- **Automation off with no applicable override: the committee has no session** (null label, flagged). The Chair Console says so, and the Executive dashboard lists such committees.

### Conformance vectors (Saturday 17 Oct, Qatar; lead 5; grace 20 proposed)

| Slot | Scheduled | switch | Window |
|---|---|---|---|
| S5 | 08:30–11:30 | 08:25 | [08:25, 12:25) |
| S6 | 12:30–14:30 | 12:25 | [12:25, 14:40) |
| S7 | 14:45–16:45 | 14:40 | [14:40, close); close = min(day close, 17:05, midnight) |

| Case | Result |
|---|---|
| Action 08:20 | label null, `outside_schedule` |
| 11:45 (break) | S5 (overrun window) |
| 14:35 / 14:41 | S6 / S7 |
| 17:10 | null, `outside_schedule` |
| S6→S7 lead 15 or 20 | switch 14:30 (never before S6's scheduled end) |
| Offline 12:24, edit published 12:10 (12:25→12:20) | assigned: next session; `displayed_label` differs; flagged |
| Same edit published 12:30 | assigned: S5 (old version); not flagged |
| Committee override vs conference override at the same time | committee wins |
| Override set under automation on | expires at next switch; an action stamped after that uses the schedule |
| Automation toggled off, no override | null, flagged, console shows "no session" |
| Automation off; override S5 set at 12:00; automation on at 12:30 | the override ends at 12:30 (`automation_enabled`); an action at 12:40 is labelled by the schedule, not S5; an action at 12:20 is still labelled S5 |
| Automation off with an override set at 22:00 | the override ends at local midnight; the next day has no session until set or automation is enabled |
| Automation toggled off then on, no override | window rule resumes from the toggle's `effective_from` |

## 4. Time confidence: when a device timestamp may authorise anything

A device timestamp is **evidence, not authority**. Everything below follows from one classification, computed by the server at receipt for every mutation and recorded with it.

**Time confidence.** An action's time is **Trusted** when either (a) the server received it within 2 minutes of its device time (an online action), or (b) the device's most recent successful sync **on the same conference day** recorded a clock offset of at most 2 minutes. Otherwise it is **Uncertain**: offset over 2 minutes, no sync that day, or a device time later than receipt by more than 2 minutes. (2 minutes is a **proposed**, unconfirmed parameter.)

**Order without clocks.** Within one device, order is the outbox sequence number (`device_seq`), which does not depend on the clock. Across devices, order uses Trusted times only.

### Acceptance table (one deterministic answer per case)

| Command class | Trusted time, in window, day open | Trusted, label differs from the device's | Trusted, outside any window | Uncertain time | Arrives after the day is closed |
|---|---|---|---|---|---|
| **Record** (scores, vote records, POI scores, document comments) | **Apply** | **Apply**; label flagged for review | **Apply**; label null, flagged | **Hold** | **Hold** |
| **Control** (queue, debate mode/phase, speech start/finish, vote open/close, resolution status) | **Apply** if the entity revision matches and the action is not stale (received within `control_stale_minutes`, default 5, proposed) | same as left, label flagged | **Hold** | **Hold** | **Hold** |
| **Roll call** (§6) | **Apply** | **Apply**, flagged | **Hold** | **Hold** | **Hold** |

**Why records are held when the time is Uncertain.** A record's validity depends on the time: historical eligibility is chosen by the action's time (§6) and the schedule version by its time (§3). An unreliable clock can therefore pick the wrong eligibility state, not only the wrong label, and scores and votes change authoritative totals before anyone reviews. There is **no automatic-application exception** for Uncertain-time records. (If the owner later wants one, it needs an explicit rule and recorded provenance: every non-label precondition independently established by identifiers alone.) **Chairs keep recording**; held work is never lost.

**Bulk review.** For a device whose clock is the only problem, the Executive can confirm the device's clock error once and approve its held items together; the confirmation is recorded.

## 5. Action lifecycle: saving is not applying

| State | Meaning | Shared-state effect |
|---|---|---|
| **Saved locally** | In the device outbox | none |
| **Received** | Durably captured by the server (UUID, payload hash, `client_time`, `device_seq`, `displayed_label`, clock offset, time confidence). Idempotent by UUID; the same UUID with a **different payload is rejected** | none until applied |
| **Applied** | Its effect ran once, under current authorisation | yes |
| **Held for review** | Received, not applied (per §4) | **none** |
| **Resolved** | A held item approved (it becomes Applied exactly once) or discarded with a reason; both retained | as decided |

- **Dependent actions.** Once a control command for a committee is held, later control commands from the **same device** (by `device_seq`) for that committee are held behind it until it is resolved. Record commands follow the table in §4 on their own.
- **Acknowledgement without loss.** The server acknowledges *Received* (including *Held*); the device removes the outbox entry only on that acknowledgement and then shows the item as "sent for review" in the status area and the notification inbox.
- **Review.** Approval applies the **original payload once** under **current authorisation** and the current entity revision; if the revision no longer matches the item stays held with the new reason. Application is idempotent by UUID; the decision (who, when, reason) is recorded; a discarded item is retained.
- **Requirements for the schema/sync owner** (not designed here, and the existing "a receipt means the effect was applied" behaviour **cannot be reused unchanged**): atomic durable receipt, crash recovery between receive and apply, UUID and payload consistency, the application transaction, and dependency and device ordering.

## 6. Roll calls: effective time, local commit and server commit are different

**Four times, never conflated.**

| Time | Meaning |
|---|---|
| `observed_at` | Device time when the roll call was taken |
| `local_committed_at` | Device time of the explicit Commit |
| `received_at` | Server receipt time |
| `server_committed_at` | When the server accepted it as committed |

**Effective time = `local_committed_at` when its time is Trusted** (§4); it is otherwise **held** and not live. Effective time is capped: if it is later than `received_at` by more than the tolerance, the roll call is **held**, so a badly future-dated roll call can never become live indefinitely.

**Roll calls are identified, committed snapshots.** `roll_call(id, committee, state: draft | committed, revision, copied_from)` with rows `status ∈ {Present, Present & Voting, Absent}`. The id is generated on the device, so a roll call taken and committed offline has a stable identity before it reaches the server.
- **Copy last roll call** (online or offline) creates a **draft** with `copied_from` and the rows copied; a draft never affects presence. The chair commits with an explicit **Commit**, sent as **one idempotent mutation carrying the full row set**, so a half-edited roll call cannot become live by accident. Abandoned drafts expire and are retained.
- A correction after commit increments `revision`, with its own effective time.

**Live presence** (controls such as adding to the queue): the committed revision with the greatest effective time, ties by id. Ordering uses effective time, not arrival, so a delayed older roll call never overwrites it.

**Historical eligibility** (validating a delayed action): the revision effective **as of the action's time**, with these causal rules:
- A dependent action **cites the roll-call id and revision** the device relied on. On the **same device** the roll call precedes the action by `device_seq`, so the server receives and applies them in that order regardless of clocks.
- The server then checks that the cited revision is committed, belongs to the committee and permits the delegate; if the action's time is Trusted and no later revision with a Trusted effective time at or before the action's time exists, the action is eligible.
- *Counterexample covered:* roll call taken and locally committed at 11:55 and participation at 11:58 on a device offline until 12:40. Both arrive at 12:40, roll call first; its effective time is 11:55 (Trusted: the device synced that day within 2 minutes offset), so a server commit time of 12:40 is **not** used for eligibility; the 11:58 action is eligible.
- *Counterexample covered:* present at 11:55, absent in a 12:30 roll call, action recorded 11:58 arriving 12:40: validated against the 11:55 revision and applied.
- If time is Uncertain at any link, the dependent action is **held** (§4).

**Votes.** When a vote opens, the server snapshots the eligible set (`Present & Voting`, and `Present` where abstention is allowed; the existing rule that `Present & Voting` cannot abstain is preserved) from the live roll call at that moment. Every vote on that resolution is validated against **that snapshot**. Once the result is **closed** it is immutable: a delayed vote arriving afterwards is **held for review**.

## 6a. Offline labelling

The server stamps `assigned_label` from the action's time with the schedule version in effect then (§3). Authorisation is checked against current access; entity relationships are validated; a late action is never rejected merely because a boundary passed. Late acceptance runs until the Executive closes that conference day; arrivals after that are held (§4).

## 7. Boundary behaviour on devices

A time boundary produces no database write, so nothing announces it. Devices hold the schedule version, lead times and overrides, compute the displayed label with a timer, and correct it on focus and reconnect. The server's assignment is authoritative; a mismatch is flagged, never an error to the chair.

## 8. Data model changes (inventory from the current code)

**Session-bound today:** `amendments`, `attendance`, `debate_states`, `documents`, `participation_events`, `speaker_queue`, `speeches`, `timers`, `votes`, plus `committees.currentSessionId` and `sessionRevision`; commands with `sessionId` in `lib/commands.ts`: `attendance`, `newDocument`, `participation`, `queue`, `timer`, `vote`, and the procedure commands in `lib/procedure/commands.ts`. Vote eligibility currently reads attendance in the resolution's session (`lib/commands.ts:327`).

| Entity | New model |
|---|---|
| Speaker queue, debate mode/phase, floor, POI queue | Committee-level; persist across sessions; session fields become labels |
| Votes | Keyed by `(resolution, delegate)`; eligibility from the vote-open snapshot (§6) |
| Attendance | Roll calls (§6) |
| Documents / amendments | The resolution owns its debate; amendment submission requires `In Debate` and committee match; no equality with a pointer |
| Participation events | The four labels (§2) |
| Timers | Removed |
| `currentSessionId`, `sessionRevision`, `currentSession` command | Removed; the chair-visible session is the derived label |

**Timer removal scope (precise).** Disconnect the persistence command path (`timer` command and its fingerprint, the server `timer` branch and its audit); **replace every consumer**, namely the read-only `<Timer>` used by the projector page (`components/workspace.tsx`), the `data.timers` reads (`components/ui.tsx`), the speech-transition timer reset, and the "session used" check that looks at timer presence; delete the projector page (owner: remove). Hiding the UI is not enough. **Database cleanup (dropping the table) is left to the schema owner.**

## 9. Deferred (approved) scope: automatic queue clear at session start

The owner approved an optional auto-clear. It is **retained as approved but deferred**, not cancelled. A device-side boundary timer would let every chair clear the shared queue independently, and an old offline queue-add could resurrect a deliberately cleared entry. The future design needs a **server-side, versioned, idempotent transition**: a per-committee `queue_epoch` bumped by the server at the boundary or by the Executive, entries carrying their epoch, and offline adds with an older epoch **held** (§4). Until then the queue persists and chairs clear it with the existing controls.

## 10. Test plan (before any merge)

Shared vectors for the window function, identical in TypeScript and SQL: all of §3's cases, including an offline action crossing a schedule edit in both orders, override precedence and expiry, automation toggled both ways, a break shorter than the lead, overnight, day close and grace, before-first and after-close. Lifecycle: every cell of the §4 acceptance table (including Uncertain-time **record** commands held), held-behind, approve applies once, replay of an approved UUID, the same UUID with a different payload rejected, crash between receive and apply, revision mismatch on approval, bulk approval after a confirmed clock error. Roll calls: the 11:55/12:30/12:40 example, **the offline roll call plus action arriving together (effective time, not server commit time, decides)**, a future-dated roll call held, a delayed older roll call, copy-last (also offline) is a draft until committed, vote snapshot with `Present & Voting` and abstention, a vote after the result closed. Speech, vote and amendment spanning a boundary; RLS unchanged (chairs see their own committee); duplicate mutation replay; the existing outbox, idempotency and PT409 tests unchanged.

## 11. Open items

- Owner: confirm or replace the 20-minute grace (decision 11), `control_stale_minutes` (5) and the 2-minute time-trust tolerance. **All three are proposals, not approved release settings.** The 5-minute lead is confirmed (decision 11).
- Reports, exports and awards that group by session are **not yet audited** for the four-label model.
- Every UI use of `currentSessionId` is not yet inventoried; the Executive archive and "session used" checks need design. (Archive: settled in the committee live state bundle, §12.13. "Session used" still counts session-linked history and published schedules.)
- Whether `Present` (non-voting) may abstain exactly as today when snapshot-based; confirm with the procedure rules. (Owner: keep the rule as today; implemented on the ballot snapshot.)
- Schema detail: `final_label` is derived, but "no correction yet" must be distinguishable from "corrected to null"; store an explicit correction record, not a nullable column that falls back to `assigned_label`.
- The review UI for held items (per device, bulk approve, reasons) is not designed. §12 gives it a minimum scope.

## 12. Implementation plan

This section tells the implementer what to build. Where it says "per §N", the rule is defined above and is not restated. Where a choice is not covered, record it in the pull request and in §11 instead of guessing.

### 12.1 Ground rules

- **Owner decisions in force:** decisions 1–10 in §1, lead 5 minutes (decision 11), and the break rule in §3: the previous session holds through the break and the next session switches at `max(start − 5 min, end of previous session)`.
- **Protected areas (`AGENTS.md`):** schema, RLS, auth, shared domain types and repository contracts. One person changes these at a time, the change is announced, and an independent reviewer reads it before it ships. Claude does not approve its own protected-area changes.
- **Migrations:** add new files under `supabase/migrations`. Never edit an applied migration. Replay every migration from empty on a local disposable Postgres before anything else. After `20261022090000_privilege_hardening`, every new table, function or RPC must grant access to the API roles explicitly.
- **Access:** no role gets `UPDATE` on `sessions` or on the new schedule tables. All writes go through security-definer RPCs in the existing batch/procedure pattern, with mutation receipts and payload fingerprints for idempotency.
- **Hosted project:** do not run anything against a hosted project. Local tests and source review only, per `AGENTS.md` and `docs/LIFECYCLE_CONTROLS.md`.

### 12.2 Phases and order

Do the phases in this order. Each one must pass its tests before the next starts.

1. **Pure window function.** Implement the window rule from §3 in TypeScript and SQL, with the shared conformance vectors from §3 and §10.
2. **Schema and RPCs** for schedule versions, overrides, roll calls, label fields, held actions and corrections (§12.3–12.4).
3. **Server labelling** on every record-writing command (§12.5), and time-confidence classification at receipt (§4).
4. **Command surface changes:** remove chair selection of sessions, add Executive schedule commands (§12.6).
5. **Roll calls and votes** (§6, §12.7).
6. **Backfill** of existing data (§12.8).
7. **UI** (§12.9).
8. **Timer removal** (§8).
9. **Docs, rehearsal scripts and permission inventory** (§12.10).

### 12.3 Schema

- **`schedule_version`**: immutable. Columns: `id`, `conference_id`, `committee_id`, `effective_from` (server time), `changed_by`, `reason`, `lead_minutes` (default 5), `grace_minutes` (default 20, proposed), `automation_enabled`, and a snapshot of the committee's session windows as jsonb, so history does not change when sessions are later edited or archived. Validation at publish follows §3 exactly; a rejected publish writes nothing.
- **`session_override`**: append-only. Columns: `id`, `conference_id`, `scope` (`committee` or `conference`), `committee_id` (null for conference scope), `session_id`, `set_by`, `set_at`, `expires_at` (stored at creation, §3). End events are separate rows that reference the override they end, with `ended_reason` (for example `automation_enabled`) and `ended_at`. Never update an existing row.
- **`roll_call`** and **`roll_call_row`**: as in §6. `id` is generated on the device. Store the four times (`observed_at`, `local_committed_at`, `received_at`, `server_committed_at`), `state` (`draft` or `committed`), `revision`, `copied_from`, and `time_confidence`. Row status is one of `Present`, `Present & Voting` or `Absent`.
- **Label fields** on every session-bound record (§2): `displayed_label`, `assigned_label`, `final_label` (derived). Reviewed corrections go in a separate `label_correction` table with its reason and audit entry. Do not use a nullable column that falls back to `assigned_label` (§11).
- **`held_action`**: one row per held command. Columns: `id` (the command UUID), `conference_id`, `committee_id`, `device_id`, `device_seq`, `payload_hash`, `reason`, `state` (`held`, `applied`, `discarded`), `decided_by`, `decided_at`, `decision_reason`. Applied and discarded rows are kept.
- **Device clock:** store the clock offset from each successful sync per device per conference day, so time confidence (§4) can be computed at receipt.
- **Session columns:** keep `slotId` on `sessions` as it is. Do not add a second link between committees and sessions.

### 12.4 Commands and RPCs

**Executive only** (add to `lib/commands.ts` permissions and the database role check):
- `scheduleVersion`: publish a new version for a committee or the conference (lead, grace, automation, windows).
- `overrideSet`: create an override at committee or conference scope.
- `automationToggle`: enable or disable automation. Enabling it appends `automation_enabled` end events for every override in scope, as §3 requires.
- `labelCorrection`: reviewed relabel, with reason.
- `heldDecide`: approve (applies the original payload once, under current authorisation and current revision) or discard, with reason.
- `clockConfirm`: confirm a device's clock error, for bulk approval (§4).

**Chair** (committee-scoped, no session parameter):
- Queue, debate mode and phase, speech, POI, vote and attendance commands keep their committee scope. Remove any requirement that the command names a session. The server stamps the label (§12.5).
- `roll_call` commands: `draftStart` (including copy of the last committed roll call), `draftEdit`, `commit` (one idempotent mutation carrying the full row set, per §6).

**Remove:** the `currentSession` command everywhere it appears: `lib/commands.ts:234`, `lib/procedure/types.ts`, `lib/procedure/commands.ts:22`, the `currentSession` branches in the migrations' `elsif command->>'type' in (...)` lists (write a new migration; do not edit old ones), `lib/sync/repository.ts:31`, `tests/helpers/authz-catalogue.ts`, `tests/helpers/authz-suite-writes.ts`, `tests/helpers/authz-suite-core.ts`, `scripts/rehearsal/scenario.ts:72`, `scripts/rehearsal/metrics.ts`, `scripts/rehearsal-run.mts`, `scripts/remote-integration.mts`. Then drop `committees.currentSessionId` and `committees.sessionRevision` in a later migration, after nothing reads them.

### 12.5 Server labelling

- On every session-bound write, the server computes `assigned_label` from the schedule version in effect at the action's time (§3, §6a). The client's `displayed_label` is stored as evidence only.
- If no window applies, store a null label and set `outside_schedule`. Never choose the nearest session.
- Time confidence (§4) is computed at receipt. Apply, hold or flag according to the acceptance table in §4. Records with Uncertain time are held, and so are control commands arriving after the day is closed.

### 12.6 Chair experience

- Chairs never choose a session. The Chair Console shows the current label, derived by the server, and the time it switches next.
- If automation is off with no applicable override, show "No session", as §3 requires.
- Dependent control commands from the same device are held behind a held control command, by `device_seq` (§5).

### 12.7 Roll calls and votes

- Roll calls follow §6 exactly. The session-start roll-call prompt fires when the chair's label changes, not when a session is created in the schedule.
- A roll call taken during a break is labelled by the window that contains its effective time. Under the 5-minute rule that is the previous session.
- Votes: on vote open, the server snapshots the eligible set from the live roll call (§6). Every vote is validated against that snapshot. Replace the current eligibility check at `lib/commands.ts:327`, which reads attendance in the resolution's session. Results are immutable once closed; a late vote is held.

### 12.8 Backfill

- For each committee, create one `schedule_version` at migration time from its active central sessions, with `effective_from` set to the migration time. Never back-date it (§3).
- Existing session-bound records keep their `sessionId` as the label source. Set `assigned_label` to that session, and mark them `legacy` so reports can tell them apart (§11).
- Sessions created before the central schedule (no `slotId`) stay read-only and are not grouped (`components/central-sessions.tsx`, "Earlier committee sessions").
- Existing per-session attendance: convert each session's attendance into one committed roll call with the same rows, effective at the session's start time, and mark it `legacy`. Confirm this conversion with the owner before running it on real data (§12.11).
- Do not migrate timers; they are removed (§8).

### 12.9 Interface

- `components/workspace.tsx:106–128`: remove the "Current session" selector for chairs. Replace it with the read-only label and switch time from §12.6.
- `components/central-sessions.tsx`: add the Executive schedule controls: publish a schedule version (lead, grace, automation), set overrides, toggle automation, and show held items with approve and discard.
- `components/admin.tsx:129`: list committees with no session (automation off, no override).
- Remove the projector page and the `<Timer>` component (§8, `components/workspace.tsx`, `components/ui.tsx`).
- Follow `docs/BRAND.md` tokens. Do not add one-off colours or sizes (`AGENTS.md`).

### 12.10 Tests and docs

- **Window function:** every case in the §3 table, in both TypeScript and SQL, with the same vectors.
- **Acceptance table (§4):** every cell, including held Uncertain-time records, held-behind controls, approve-once, replay of an approved UUID, same UUID with a different payload rejected, revision mismatch on approval, bulk approval after a confirmed clock error.
- **Roll calls and votes (§6):** the 11:55/12:30/12:40 example, offline roll call plus action arriving together, future-dated roll call held, delayed older roll call, copy-last as draft until committed, vote snapshot with `Present & Voting` and abstention, late vote after close.
- **Overrides and automation (§3):** precedence, expiry, automation toggled both ways, overnight override expiry.
- **Authorisation:** chairs denied every schedule command and every write to `sessions`; `tests/helpers/authz-catalogue.ts` updated; `docs/generated` permission inventory regenerated.
- **Updated existing tests:** `tests/procedure.test.ts`, `tests/procedure-usability-db.test.ts`, `tests/archive-blockers.test.ts`, `tests/rehearsal-multi-committee.test.ts` and `tests/rehearsal.test.ts` (the `TOPIC_OF` list at line 131 and the floor list at line 34) must match the new command surface.
- **Docs:** update `docs/STAGING_REHEARSAL.md:42` (remove the "each Chair selects it" step) and `docs/BACKLOG.md` if the plan changes priorities.
- **Before declaring UI work done:** `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`, plus a real browser check of the chair and Executive views (`AGENTS.md`).

### 12.11 Open questions to settle before the relevant phase

- **Close grace (20 minutes):** still proposed. Confirm it, or confirm the last session of the day closes at midnight.
- **Attendance conversion (§12.8):** confirm the rule before it touches real data.
- **Roll call during a break:** the design labels it with the previous session. Confirmed by the owner (previous session); implemented.
- **Reports and exports** that group by session (§11) need a separate design before the four-label model is used in reports.
- **Timer table:** dropping it is left to the schema owner (§8).

### 12.12 Done means

- Chairs cannot select, write or see a session they should not; the dropdown is gone.
- Sessions switch by the schedule, with the 5-minute lead and break rule, with no chair action.
- Every session-bound record carries the four labels, and "outside schedule" is flagged, not guessed.
- Held items wait for Executive review and are applied at most once.
- The §3, §4 and §6 vectors pass in TypeScript and SQL, and the migration replays from empty.
- The authorisation tests, the updated existing tests and the browser checks pass.
- Anything not done is listed in §11 rather than left implicit.

### 12.13 Implementation log

**Phase 1: pure window function (done).** `lib/sessions/window.ts` (TypeScript) and `supabase/migrations/20261029100000_session_window.sql` (SQL, schema `private`, no API-role grants, no tables) implement the §3 window rule, publish validation, version-in-effect, override expiry and override/automation resolution. Both run the same vectors, `tests/fixtures/session-window-vectors.json`, in `tests/session-window.test.ts` and `tests/session-window-db.test.ts`. Lead and grace are parameters of the schedule version (defaults 5 and 20; the 20 is still proposed). Choices the document did not settle, recorded here and to be confirmed:

- A lead that reaches back past local midnight is clamped to the start of the day: a window never crosses a day boundary.
- A window that would be empty (an Executive close-day before the switch) is dropped. The previous window still ends at that switch, as the rule says.
- The Executive close-day applies to the last session of the day only, as written in §3.
- Override ties (same scope, same `set_at`) go to the higher id. Every override ends at the next local midnight after it was set.
- A conference-scope override carries an opaque label (`sessionId`). Which label a conference-wide override sets for committees with different session ids is not defined in §3 and needs an owner decision before phase 2.
- The "label differs from the device's" flag in the §3 worked case belongs to phase 3, where `displayed_label` exists. Phase 1 covers the assignment half of that vector.
- Precision is the millisecond. Every instant is truncated to the millisecond on entry in both implementations (JavaScript clocks stamp device actions; PostgreSQL keeps microseconds). A change published at 09:00:00.000900 takes effect at 09:00:00.000 everywhere. The shared vectors include fractional-second cases for windows, versions, overrides and expiry.

**Phase 2: schema and Executive commands (done on the branch, unapplied, awaiting independent review).** Migration `20261029110000_session_schedule.sql` is a PROTECTED change (schema, RLS, access, destructive-tooling coverage). It adds `schedule_version`, `session_override` (+ `session_override_end`), `roll_call` (+ `roll_call_row`), `record_label`, `label_correction`, `held_action`, `device_clock_sync` and `clock_confirmation`, and five Executive-only commands routed through the existing `apply_operations_mutation` dispatcher (lifecycle lock, receipts, idempotency, audit and notifications are inherited): `scheduleVersion`, `automationToggle`, `overrideSet`, `labelCorrection`, `clockConfirm`. Every table is SELECT-only for `authenticated` through RLS and has no privilege for `service_role`; schedule versions, overrides, end events, corrections and clock confirmations are append-only (trigger). The commands require a conference-wide admin grant, so a committee-scoped admin cannot change any schedule. Owner decisions applied: a **conference-wide override names a central slot** (each committee resolves its own session in it; a committee with none shows "No session", flagged), and the **default grace stays 20 minutes** (a per-version parameter).

Choices to review, because §12.3 did not settle them:

- **Labels live in a side table.** `record_label(record_table, record_id, displayed_label, assigned_label, outside_schedule, ...)` replaces columns on the nine session-bound tables, so no existing table, snapshot shape or sync contract changes. `final_label` is `private.final_label()`: the latest explicit `label_correction` (a null correction is a real correction), otherwise `assigned_label`. Phase 3 writes the rows.
- **Automation toggle is a new version** copying the latest snapshot. Enabling ends every manual override in scope by appending `session_override_end` rows (`automation_enabled`): one committee ends that committee's committee-scope overrides; the whole conference ends all of them and the conference-scope ones. A no-op toggle writes nothing.
- **Review fixes (first Codex review of phase 2).** (1) Roll calls are readable by Executive, Chair and observer only, the attendance boundary; Approval Panel and Logistics cannot read delegates' statuses. (2) A conference-wide override captures `{committeeId: sessionId | null}` in `session_override.targets` when it is set, so archiving a slot or session cannot change a historical assignment; a committee created afterwards is not covered. (3) Every path that turns automation on ends the overrides in scope through one helper, `private.end_overrides`: `automationToggle` enable (including committees already on, and the whole conference), and a `scheduleVersion` published with automation on. Publishing with automation off ends nothing. (4) A bulk change (every committee) takes one `effective_from` for all its versions and for the override endings it causes, so resolving exactly at that instant gives the schedule for every committee; a single-committee change is unchanged.
- **Conference-scope override expiry is derived, not stored.** Versions are immutable, so each committee derives the expiry from its own versions at `set_at`; the stored value is null. Committee-scope expiry is stored at creation, as §3 requires.
- **The conference time zone** comes from `private.conference_settings` (default `Asia/Qatar`) so the database and the client agree on local midnight. The client still reads `NEXT_PUBLIC_CONFERENCE_TIMEZONE`; keep them equal if the venue ever changes.
- **Executive "close day" is not stored yet.** The window function takes it as input; no table or command records it. Needed before the last window of a day can be closed early.
- **Not in this phase:** `heldDecide` (no held rows exist before phase 3), roll-call commands (phase 5), reads through the snapshots (phases 4 and 7), the schedule-publish UI (phase 7).
- **Destructive tooling changed.** `scripts/cleanup/00-prepare.sql` has rules for the eleven new tables (steps renumbered; `docs/SYNTHETIC_CLEANUP.md` updated) and the fixture populates them. The append-only triggers allow DELETE only while `munos_cleanup.mode = 'execute'`, which only that reviewed script sets.
- **The PostgreSQL 17 suites were not run here** (only PGlite and a local PostgreSQL 16). The grants inventories under `docs/generated` were regenerated on 16 and converted to 17 by a transform that reproduces the approved phase 1 files byte for byte; `npm run check:grants` on 17 is the real check.

**Phase 3a: record labelling and time confidence (done on the branch, unapplied, awaiting independent review).** Migration `20261030090000_record_labelling.sql` (PROTECTED: patches the three Chair write dispatchers). **Labels only: no action is held, rejected or reordered; everything accepted before is accepted now with the same effects.** Staging, per the owner (30 Oct): the hold rules, held-behind ordering and the Executive approve / discard / bulk-approve commands are **phase 3b**, to follow once clients send a device id and clock offset; nobody is using the site until 5 November.

- **Mechanism.** Each dispatcher (`apply_mutation`, `apply_procedure`, `apply_operations_mutation`) records a transaction-local context first thing after the lifecycle lock: the conference, mutation, client time and the optional `command._device = {deviceId, deviceSeq, displayedLabel}`. An AFTER trigger on each Record-class table (`participation_events`, `participation_corrections`, `votes`, `document_comments`, `participation_adjustments`) writes the row's `record_label` in the same transaction, so a record and its label commit or roll back together. A vote re-recorded in place is re-labelled with the newest action. The context is overwritten by every dispatcher call, and API roles cannot write these tables except through one.
- **Time confidence (§4).** Trusted when received within `conference_settings.time_trust_minutes` (default 2, proposed) of the device time, or when the device's latest `device_clock_sync` on the same conference day shows an offset within it; a device time later than receipt by more than the tolerance is Uncertain.
- **Which time labels.** A Trusted action is labelled from its device time. An Uncertain one is labelled from the server's receipt time (an unreliable clock must not choose the session) and recorded as `uncertain`, ready for phase 3b to hold. Outside every window: `assigned_label` null, `outside_schedule`; automation off with no override, or no schedule version yet: null, `no_session`. `label_differs` flags a displayed label that differs from the assignment; a displayed label from another committee is dropped, not stored.
- **Not yet.** Nothing writes `device_clock_sync` yet (the device-side sync call arrives with the client work in phase 4), so until then only online actions are Trusted. Control commands are classified and held in 3b. `legacy` backfill is phase 6.

**Bundle: hold rules, Executive review, device protocol, review UI (done on the branch, unapplied, awaiting independent review).** Migrations `20261030100000_session_holds.sql` and `20261030110000_session_schedules_snapshot.sql`, plus the client. The two 3a review findings are fixed in `20261030090000` and `20261030100000`: a displayed label the device explicitly reported as "no session" is recorded (`displayed_reported`) and flagged when it differs from the assignment, and a published session can no longer be deleted (archive instead; the reviewed cleanup script is exempt), with the label trigger degrading to "no session" rather than failing a score if a referenced session were ever missing.

- **Enforcement is a switch, default OFF** (`conference_settings.hold_enforcement`, Executive command `holdSettings`, which also sets the trust and stale tolerances). With it off nothing is held and the behaviour is exactly phase 3a's. Reason: with no schedule published a committee has "no session" and enforcing would hold every Control command. The Executive turns it on once schedules are published and devices report their clocks. Decision for the owner: when to switch it on, and with which tolerances (trust 2 min and stale 5 min are still proposals).
- **Acceptance table (§4)**, for a Chair's Record and Control commands only. Record (`participation`, `event`, `vote`, `speechScore`, `poiScore`, `pointAdjustment`): applied when Trusted (a label or flag per §2), held when Uncertain or after the day was closed. Control (`queue*`, `debateMode`, `speech*`, `poi*`, `voteMode`, `document`): applied when Trusted, inside a window, fresh, and not behind a held earlier Control from the same device and committee; otherwise held. Everything else (Executive configuration, Approval and Logistics actions, drafting, attendance until roll calls in the next bundle) is exempt.
- **Received means acknowledged.** A held command is parked in `held_action` with its original command and acknowledged, so the device drops it from its outbox; a retry of the same key and payload is a no-op, a different payload under the same key is rejected. The retry check runs before the permission check, per the 22 October rule on exact retries.
- **Approval re-runs the original command once** (`heldDecide`), as the original actor, under that actor's CURRENT permissions and the current entity revision. Mechanism, for the reviewer: for the duration of one approval the transaction-local claim `request.jwt.claim.sub` is switched to the original actor and restored before returning (`private.run_held`), because every dispatcher and `private.has_access` read the caller from `auth.uid()`. It is reachable only from the Executive commands. If the revision moved on, the actor lost access, or the command no longer applies, the item stays held with the new reason (`revision_mismatch`, `actor_not_authorised`, `not_applicable`) and nothing is applied. The Executive's decision is audited under the Executive; the applied effect, receipt and audit row carry the Chair.
- **Bulk approval** (`heldBulkApprove`): after `clockConfirm` states a device's clock error, its items held for the clock (`uncertain_time`, `behind_held`) are approved in device order and labelled by the corrected time (`time_confidence` trusted, `held_action_id` set). A single approval does not claim the clock was right: the label uses the original receipt time and stays `uncertain`.
- **Day close** (`closeDay`, one-way): caps the last window of that day and holds anything that arrives for it afterwards.
- **Device protocol.** The client assigns a device id (stable per browser profile), a sequence that only grows (allocated atomically across tabs), and the displayed label, sent as `command._device` without changing the saved command. It reports its clock offset (`public.record_device_clock`) before it sends, at most once a minute, and a failure never stops the outbox. The schedule a device needs to compute its displayed label arrives in `operations_snapshot` (`sessionSchedules`, one entry per committee the caller may read; `holdSettings`; `dayCloses`; `heldActions`).
- **Screens.** Executive: Operations → Held for review (the rules switch, close today, held items per device with approve/discard and confirm-clock-and-approve, recent decisions). Chair: a notice that N actions are waiting for review. Checked in a real browser in demo mode with injected data; the Chair's removal of the session selector, the Chair Console label and the schedule-publishing controls are the next bundle.
- **Not in this bundle:** roll calls and vote snapshots, removing Chair session selection and the `currentSession` command, timer removal, backfill, real-data conversion.
- **Review fixes (first Codex review of this bundle).** (1) The Executive session commands have no optimistic projection and enter the durable outbox like any other command; the offline demo refuses them. (2) The access-gated transport forwards the clock report under the same access checks. (3) A later held Control cannot be approved while an earlier held Control from the same device and committee is still held; in bulk approval a failed Control keeps the later Controls for that committee held, while Records continue. (4) A missing or null `decision` is rejected and the item is unchanged. Rollout guidance from the review: 2-minute trust and 5-minute staleness as configurable rehearsal defaults; enable holding first on synthetic fixtures with published schedules and working clock and review flows, and on the actual conference only after the complete workflow passes review.
- **Review fixes (second Codex review of this bundle).** (1) Bulk approval checks, before each Control, every earlier UNRESOLVED Control from that device and committee whatever it was held for (including reasons the batch does not approve, such as `outside_window`, and a `revision_mismatch` left by an earlier attempt); Records stay independent. (2) The device's clock report has a 3-second deadline; on failure or timeout sending carries on, so a report that never answers cannot hold the sync lock. (3) The grants inventories are regenerated after every SQL edit, because their checksum covers migration contents, not just signatures.


**Bundle: committee live state, roll calls, ballot snapshots, Chair session selection removed (done on the branch, unapplied, awaiting independent review).** Migration `20261031090000_committee_live_state.sql` (PROTECTED: schema, RLS, the four Chair write dispatchers, snapshots, destructive-tooling coverage), plus the client, the rehearsal harness and the tests. Owner decisions applied: **full rekey of live state to the committee**; a **break roll call is labelled with the previous session**; the **abstention rule is unchanged** (Present & Voting cannot abstain, Present can, Absent cannot vote); **Chairs never choose a session** (selector and `currentSession` removed).

- **How the rewritten functions were made.** Every changed dispatcher, snapshot and helper (`apply_procedure`, `apply_mutation`, `apply_staff_batch`, `conference_snapshot`, `executive_snapshot`, `submit_amendment`, `submit_resolution`, `ops_point_adjustment`, `apply_conference_mutation`, `hold_gate`, `veto_delegates`) is generated from its definition in force after `20261030110000` with exact-text replacements that must each match a stated number of times, so every earlier patch (lifecycle lock, labelling context, hold gate, held replay, archive guards) is carried over. The generator refuses to run if any expected text is missing.
- **Live state is keyed by committee.** New rows in `speaker_queue`, `speeches`, `debate_states` and `votes` have no session; partial unique indexes keep one active queue entry per delegate and lane, one speech on the floor, one debate state and one ballot per delegate per resolution. Rows written under the old model keep their session and are history. Commands name their committee; one saved by an older build that names a session is accepted, and the session only identifies the committee. Resolutions and amendments created from now on carry no session; the schedule labels records.
- **Retired commands.** `currentSession`, `attendance` and `timer` are refused with 22023 for every caller who could otherwise send them (the authorisation matrix marks them retired). The `timers` table is left in place for the schema owner (§12.11).
- **Roll calls (§6).** `rollCallCommit` commits one whole roll call (every row) from a device-made id; a correction is the next revision of the same id, and revision n+1 needs revision n. Its effective time is the device time when Trusted, otherwise the receipt time, never in the future. Only the live roll call (greatest effective time, ties by id then revision) changes the floor: a delayed older one is stored but removes nobody from the queue. Roll calls are labelled like other records; one taken in a break gets the previous session. With enforcement on, a roll call is held like a Control when its time is Uncertain.
- **Historical eligibility.** An action that needs a delegate present is checked against the roll call effective at the action's trusted time (`private.eligible`), or against the roll call it cites (`rollCall: {id, revision}`) unless a later Trusted revision effective before the action supersedes it. So an offline roll call and the queue action that relied on it can arrive together and apply.
- **Ballots.** `voteMode` opens (or restarts) a ballot and snapshots every delegate's status from the roll call in force (`ballot_eligibility`, readable by Executive, Chair and observer). Votes are checked against that snapshot, so a later roll call does not move an open ballot; the counted close and the veto use it too. A vote that arrives after the result is refused, or held as `ballot_closed` with enforcement on.
- **Archive boundary.** Live work is committee-level, so the committee is now the archive boundary for it: every live Chair write to an archived committee is a `PT409` stale conflict, including amendment status. Archiving a session no longer stops the committee's live work (sessions are labels). This settles the archive half of the §11 item; a session's "in use" check still counts session-linked history and published schedules.
- **Chair screens.** The session selector is gone. The Chair Console shows the schedule's label for now and a prompt when no roll call is live; the roll call screen keeps a draft on the device (never sent, never counted) with Copy last roll call, Correct last roll call and Commit; voting shows the ballot's snapshot. Executive → Sessions gains publish schedule, pause/resume automation and set session now.
- **Seed and upgrade tests.** `supabase/seed.sql` writes the live rows in the shape the schema has: committee-keyed rows and roll calls once this migration is applied, the session-keyed rows (attendance, queue, events, a timer) otherwise, so upgrade tests can still seed an older schema.
- **Verification.** Full suite on PGlite (790 pass); the PostgreSQL 17 suites on a disposable local 17 server (authorisation matrix 51, grants drift 38, privilege hardening 13 and the concurrency and cleanup suites, all pass); grants inventories regenerated (no privilege-policy violations); demo browser rehearsal S0–S9 pass. The hosted scripts (`remote-integration`, `remote-workflow`, `load-test`) are updated and type-check but were not run: no hosted project was touched.
- **Not in this bundle:** converting existing attendance to roll calls before real data (§12.8, open in §12.11), reports and exports by session (§12.11), dropping the `timers` table (§12.11), production cutover.

- **Review fixes (first Codex review of this bundle, `989fbcb`).** (1) A roll call is admitted, labelled and made effective by its OWN commit time: `private.command_device_time` returns the command's `committedAt` for `rollCallCommit` (an unreadable one is Uncertain), and both `hold_gate` and `set_mutation_context` use it, so with holding on a future-dated roll call carried by an on-time action is held, a trusted roll call carried by a stale action is admitted, and the session label comes from the same instant as the effective time. (2) The client compares instants as milliseconds (`instant`, `before`, `atOrAfter` in `lib/sessions/presence.ts`), never as text: database times ("…+00:00", or in the session's offset) and device times ("….000Z") are different strings for the same moment. This covers roll call selection and ordering, ballot eligibility, "roll call due", the session count windows and the Chair totals. (3) A presence-gated action (`queue`, `queueAdd`, `speechStart`, `speechYield`, `poiAdd`) saves `rollCall: {id, revision}`, the live roll call the Chair saw, at the queue/apply boundary, so valid offline work is judged against it after another device uploads a roll call. (4) Archiving a slot is no longer blocked by a retained document or committee session pointer: sessions are labels. The committee archive keeps its "close the resolution debate" rule. Regression tests: the hold, label and effective time case in `committee-live-state-db`, the slot archive case in `staff-batch-db`, and `roll-call-client.test.ts` (mixed time formats and offsets, Felix and counts, the saved reference, and the outbox). The DB session fixtures now run the conference in a fixed-offset zone where "now" is local midday, which removes the two midnight-dependent failures (a session window never crosses local midnight).

- **Review fixes (second Codex review of this bundle, `9d13feb`).** (1) Client eligibility mirrors `private.eligible`: `isEligible` checks a presence-gated action against the roll call it cited, unless a LATER Trusted revision effective at or before the action supersedes it, and refuses a citation the device does not hold. Projection, reload and replay therefore show what the server will accept after a later Uncertain roll call arrives. (2) `poiRecognize` saves its citation like the other presence-gated actions (the server checks the recognised delegate). (3) Amendment status and restoring a deduction no longer depend on the amendment's or deduction's session being operational: the session is a historical label that is preserved, and only an archived committee blocks them (a stale conflict). A populated upgrade test seeds session-linked rows on the previous schema, archives the session, upgrades, and checks both operations and the preserved labels. (4) Two tests that waited a fixed 20 ms for a refusal now wait, bounded, for it.
