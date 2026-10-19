# Session model: sessions are a schedule that labels records (contract draft v2)

**Status:** draft contract for review; **not approved for schema work.** No schema or command code has been changed for this model. Revised on 19 October 2026 after the independent review of draft v1 (`85012ca`), which found four contract blockers (action review state, schedule history, roll-call semantics, internal contradictions). Schema, RLS and sync-contract changes are shared-architecture work, serialised under one integration owner (see `AGENTS.md`) and cross-reviewed.

## 1. Decisions and their provenance

| # | Decision | Provenance |
|---|---|---|
| 1 | Sessions are a schedule display; the committee holds live state; the **server** stamps a session label on records; chairs never choose it | **Owner**, 19 Oct 2026: asked for sessions to become "more of a display of schedule rather than everything being tied to them"; "approve" |
| 2 | Only the Executive controls the schedule, lead times, overrides and automation | **Owner**, earlier in the session ("committee sessions should be ONLY changeable by the executive") |
| 3 | Lead time begins in the break; the next session's switch is configurable minutes before it begins | **Owner**: "lead time should begin in the breaks" |
| 4 | Overruns are allowed until the next session's switch time | **Owner**: "overruns are allowed to go as far as the beginning of next session lead time" |
| 5 | Automation is toggleable | **Owner**: "automation for session switching should be toggle able" |
| 6 | An offline action is labelled by the session whose window contains its device time | **Owner**: "offline actions … submitted if time on device matches that committee session's time as scheduled" |
| 7 | Queue and debate mode persist across sessions | **Owner**: answered "yes" to persisting by default. The optional auto-clear is **withdrawn** from this draft (§9) |
| 8 | Roll call is prompted at each session start, with an option to copy the last roll call | **Owner**: "yes with option to copy last sessions roll call" |
| 9 | Timers are local-only and not audited; the projector page is removed | **Owner**: timers "not necessary to audit and save"; projector: "6. Remove" |
| 10 | Amendments and votes belong to the resolution, not the session | Follows from decision 1; owner approved the restructure |
| 11 | Lead default 5 minutes; close grace 20 minutes | **Proposed, unconfirmed by the owner.** Both are parameters, not rules. The contract cannot be frozen until the owner confirms or replaces them |

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
- Expiry: with automation on, `expires_at` is the next scheduled switch (computed and stored at creation under the schedule version in effect, so history is stable); with automation off, none (until changed).
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
| Automation toggled off then on | window rule resumes from the toggle's `effective_from` |

## 4. Action lifecycle: saving is not applying (resolves the review blocker)

Every mutation has a durable server-side state, separate from its device state:

| State | Meaning | Shared-state effect |
|---|---|---|
| **Saved locally** | In the device outbox | none |
| **Received** | The server has durably captured the mutation (UUID, payload, `client_time`, `displayed_label`, clock offset). Idempotent by UUID. The device may now drop it from the outbox | none until applied |
| **Applied** | Its effect ran once, under current authorisation | yes |
| **Held for review** | Received, **not** applied; shown to the Executive and to the author | **none** |
| **Resolved** | Held item approved (becomes Applied exactly once) or discarded with a reason; both retained in the ledger | as decided |

**Which commands apply immediately.**
- **Record commands** (participation and speech scores, POI scores, vote records, document comments): apply with the original time and label even when the label is flagged, **provided** their own preconditions hold (entity exists, revision matches, eligibility as of the action time, §5). A flagged label never changes the effect, only the attribution.
- **Control commands** (queue add/remove/order, debate mode/phase, speech start/finish, vote open/close, resolution status changes): apply only if **all** hold: the entity's expected revision still matches (existing optimistic fingerprint), the action is **not stale** (received within `control_stale_minutes`, default 5, of its device time), and the label confidence is normal (§6). Otherwise it is **Held for review** with the reason. A stale queue clear, debate-mode change or vote operation therefore cannot change today's state because it carries an old time.
- **Dependent actions.** Once a control command for a committee is held, later *control* commands from the same device for that committee are held behind it until it is resolved ("held behind"). Record commands continue to apply when their own preconditions hold, otherwise they are held. The chair keeps recording throughout; a boundary never causes a lost action.

**Acknowledgement without loss.** The server acknowledges *Received* (including *Held*). The device removes the outbox entry only on that acknowledgement; it then shows the item as "sent for review" in the status area and Leo's inbox. Nothing is dropped while *Held*.

**Review.** The Executive approves or discards a held item. Approval applies the **original payload once** under the **current** authorisation and the current entity revision; if the revision no longer matches, the item stays held with the new conflict reason. Application is idempotent by mutation UUID (the receipt ledger), and the decision is recorded (who, when, reason). A discarded item is retained.

## 5. Roll calls: historical eligibility is not live presence (resolves the review blocker)

**Roll calls are identified, committed snapshots.**
- `roll_call(id, committee, taken_at, committed_at, revision, copied_from, state: draft | committed)`; rows carry `status ∈ {Present, Present & Voting, Absent}` (the existing attendance statuses).
- **Copy last roll call** creates a **draft** with `copied_from` set and the rows copied, in one server-side step. A draft **never** affects presence. Partial edits stay a draft. The chair commits with an explicit **Commit** action, sent as one idempotent mutation carrying the full row set, so a half-edited roll call cannot become live by accident. An abandoned draft expires and is retained.
- A correction after commit (late arrival) increments `revision`; the revision effective at a given time is the one with the greatest `committed_at` not later than it.

**Two different questions, two answers.**
- **Live presence** (is this delegate present *now*, for controls such as adding to the queue): the committed roll call with the greatest `taken_at` (ties by id). A **delayed older roll call** never overwrites it: ordering is by `taken_at`, not arrival, and an older one is recorded as history only.
- **Historical eligibility** (was this delegate eligible when a delayed action was recorded): the committed roll call, at its effective revision, that was latest **as of the action's device time**. *Example:* present at 11:55, marked absent by a 12:30 roll call; a speech score recorded at 11:58 arrives at 12:40. It is validated against the 11:55 roll call and applies. It is not rejected because a newer roll call exists.

**Votes.** When a vote opens, the server snapshots the eligible set (delegates `Present & Voting`, and `Present` where abstention is permitted; the existing rule that `Present & Voting` cannot abstain is preserved) from the live roll call at that moment. Every vote on that resolution is validated against **that snapshot**, never against a later roll call. Once the result is **closed** it is immutable: a delayed vote arriving afterwards is **held for review** and changes nothing.

## 6. Offline labelling and confidence

- The server stamps `assigned_label` from the action's device time with the schedule version in effect then (§3).
- **Clock safeguard.** The device records its clock offset at each successful sync and sends it with the mutation. If the offset exceeds 2 minutes, or the device has not synced that day, label confidence is **uncertain**: record commands still apply (flagged for label review); control commands are **held** (§4).
- Authorisation is checked against current server access; entity relationships are validated; a late action is never rejected merely because a boundary passed.
- Late acceptance: until the Executive closes that conference day; later arrivals are held for review.

## 7. Boundary behaviour on devices

A time boundary produces no database write, so nothing announces it. Devices hold the schedule version, lead times and overrides, compute the displayed label with a timer, and correct it on focus and reconnect. The server's assignment is authoritative; a mismatch is flagged, never an error to the chair.

## 8. Data model changes (inventory from the current code)

**Session-bound today:** `amendments`, `attendance`, `debate_states`, `documents`, `participation_events`, `speaker_queue`, `speeches`, `timers`, `votes`, plus `committees.currentSessionId` and `sessionRevision`; commands with `sessionId` in `lib/commands.ts`: `attendance`, `newDocument`, `participation`, `queue`, `timer`, `vote`, and the procedure commands in `lib/procedure/commands.ts`. Vote eligibility currently reads attendance in the resolution's session (`lib/commands.ts:327`).

| Entity | New model |
|---|---|
| Speaker queue, debate mode/phase, floor, POI queue | Committee-level; persist across sessions; session fields become labels |
| Votes | Keyed by `(resolution, delegate)`; eligibility from the vote-open snapshot (§5) |
| Attendance | Roll calls (§5) |
| Documents / amendments | The resolution owns its debate; amendment submission requires `In Debate` and committee match; no equality with a pointer |
| Participation events | The four labels (§2) |
| Timers | Removed |
| `currentSessionId`, `sessionRevision`, `currentSession` command | Removed; the chair-visible session is the derived label |

**Timer removal scope (precise).** Disconnect the persistence command path (`timer` command and its fingerprint, the server `timer` branch and its audit); **replace every consumer**, namely the read-only `<Timer>` used by the projector page (`components/workspace.tsx`), the `data.timers` reads (`components/ui.tsx`), the speech-transition timer reset, and the "session used" check that looks at timer presence; delete the projector page (owner: remove). Hiding the UI is not enough. **Database cleanup (dropping the table) is left to the schema owner.**

## 9. Withdrawn: automatic queue clear at session start

The draft v1 setting is withdrawn. A device-side boundary timer would let every chair clear the shared queue independently, and an old offline queue-add could resurrect a deliberately cleared entry. A future design needs a **server-side, versioned, idempotent transition**: a per-committee `queue_epoch` bumped by the server at the boundary or by the Executive, entries carrying their epoch, and offline adds with an older epoch **held** (§4). Until then the queue persists and chairs clear it with the existing controls.

## 10. Test plan (before any merge)

Shared vectors for the window function, identical in TypeScript and SQL: all of §3's cases, including an offline action crossing a schedule edit in both orders, override precedence and expiry, automation toggled both ways, a break shorter than the lead, overnight, day close and grace, before-first and after-close. Lifecycle: record vs control, stale control, label-uncertain control held, held-behind, approve applies once, replay of an approved UUID, revision mismatch on approval. Roll calls: the 11:55/12:30/12:40 example, a delayed older roll call, copy-last draft not live until committed, vote snapshot with `Present & Voting` and abstention, a vote after the result closed. Speech, vote and amendment spanning a boundary; RLS unchanged (chairs see their own committee); duplicate mutation replay; the existing outbox, idempotency and PT409 tests unchanged.

## 11. Open items

- Owner: confirm or replace the 5-minute lead and 20-minute grace (decision 11), and `control_stale_minutes` (default 5, proposed).
- Reports, exports and awards that group by session are **not yet audited** for the four-label model.
- Every UI use of `currentSessionId` is not yet inventoried; the Executive archive and "session used" checks need design.
- Whether `Present` (non-voting) may abstain exactly as today when snapshot-based; confirm with the procedure rules.
