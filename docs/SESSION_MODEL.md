# Session model: sessions are a schedule that labels records (contract draft)

**Status:** draft contract for review. **No schema or command code has been changed for this yet.** Per the independent audit of 19 October 2026, contracts come before implementation. Schema, RLS and sync-contract changes are shared-architecture work and are serialised under one integration owner (see `AGENTS.md`); this document is the review artefact for that owner and for Codex.

Origin: PHESMUN day-one/day-two findings (chairs choosing sessions drifted from the schedule; a session switch stranded live state; amendments failed across sessions) and the owner's decisions of 19 October 2026.

## 1. Decisions (owner, final unless stated)

1. **Sessions are a schedule display.** The committee holds the live state. A session is a label the **server** stamps on records from the schedule. Chairs never choose, supply or change it.
2. **Only the Executive** controls the schedule, lead times, overrides and automation. The Chair Console has no session control.
3. **Lead time begins in the break.** The next session's label starts a configurable number of minutes before it begins, **never before the previous session's scheduled end**.
4. **Overruns are allowed** until the next session's switch time.
5. **Automation is toggleable** (conference-wide, with a per-committee override). With automation off, labels come only from Executive overrides.
6. **Offline actions** are labelled by the session whose window contains the device timestamp, with the clock-offset safeguard in §6.
7. **Roll call** is prompted at each session start. Presence means "present in the latest roll call". The Chair can **copy the last roll call**.
8. **Queue and debate mode persist** across sessions by default; an optional auto-clear at session start is a setting (default off).
9. **Timers are local-only** (not persisted, not audited). The projector page is removed.
10. **Amendments and votes belong to the resolution**, not the session.
11. **Defaults (configurable):** lead 5 minutes; last-session close grace 20 minutes. Proposed, not yet confirmed by the owner.

## 2. Window rule

For a committee with sessions `S1..Sn` ordered by start, lead `L` (conference default, optional per-slot override):

- `switch(Sk) = max(start(Sk) − L, end(S(k−1)))`; for the first session of a day, `start(S1) − L`.
- `window(Sk) = [switch(Sk), switch(S(k+1)))`.
- The last session of a day: `window(Sn) = [switch(Sn), close)` where `close = min(Executive "close day", end(Sn) + grace)`.
- Before the first window of a day, and after `close`: **no scheduled session**. Records are still accepted, labelled with the nearest session and flagged `outside_schedule`.
- Windows use the committee's **own** session rows (`sessions.startsAt/endsAt`), so per-committee schedule edits are respected.

**Executive override:** `(committee | all, session, set_by, set_at)`. With automation on, an override lasts until the next scheduled switch. With automation off, until changed again.

### Test vectors (Saturday 17 Oct schedule, Qatar time; lead 5)

| Slot | Scheduled | switch | Window |
|---|---|---|---|
| S5 | 08:30–11:30 | 08:25 | [08:25, 12:25) |
| S6 | 12:30–14:30 | 12:25 | [12:25, 14:40) |
| S7 | 14:45–16:45 | 14:40 | [14:40, close); close = min(day close, 17:05) |

| Instant | Label |
|---|---|
| 08:20 | none, `outside_schedule` |
| 11:45 (break) | S5 (overrun window) |
| 14:35 | S6 |
| 14:41 | S7 |
| 17:10 | S7, `outside_schedule` |
| S6→S7 with lead 15 or 20 | switch = 14:30 (not earlier than S6's scheduled end) |

## 3. What changes (inventory from the current code)

**Tables with a session foreign key today:** `amendments`, `attendance`, `debate_states`, `documents`, `participation_events`, `speaker_queue`, `speeches`, `timers`, `votes`, plus `committees.currentSessionId` and `sessionRevision`.

| Entity | New model |
|---|---|
| Speaker queue, debate mode and phase | Committee-level; keyed by committee, persisted across sessions; `sessionId` becomes a stamped label only |
| Floor (speeches), POI queue | Committee-level; a live speech is never stranded by a boundary; session label stamped at start |
| Votes | Keyed by `(resolution, delegate)`; the session is a label |
| Attendance | **Roll calls** (`roll_calls(id, committee, taken_at)`) with per-delegate status; presence = latest roll call; "copy last roll call" creates a new roll call with statuses copied |
| Documents / amendments | The resolution owns its debate; amendment submission requires `status='In Debate'` and committee match; no equality with a current-session pointer; session stamped on creation |
| Participation events | Session is a server-stamped label (from the action's time window), never supplied by a chair |
| Timers | Removed (`timers` table, `timer` command, projector page); a local countdown remains on the Chair Console |
| `committees.currentSessionId`, `sessionRevision`, command `currentSession` | Removed. The chair-visible "current session" is the derived label |

**Commands carrying `sessionId` in `lib/commands.ts`:** `attendance`, `newDocument`, `participation`, `queue`, `timer`, `vote`; procedure commands in `lib/procedure/commands.ts` also key on it (`debateMode`, queue, speech and POI commands). Both the TypeScript (`applyCommand`) and SQL (`private.apply_*`) implementations change together, guarded by conformance tests.

## 4. Roll call

- A prompt appears on the Chair Console when the label changes and no roll call exists since the window began.
- Options: take a new roll call, or **copy the last roll call** (editable afterwards).
- The "delegate must be present" checks read the latest roll call, not a per-session attendance row.

## 5. Executive controls

Conference settings (editable by the Executive only, audited): `session_lead_minutes` (default 5), per-slot lead override, `session_automation` (conference and per committee), `session_close_grace_minutes` (default 20), `day_closed_at`, and the optional `clear_queue_at_session_start` (default off). Manual override as in §2. Recording is **never blocked** by a boundary or by "day closed"; it is labelled and flagged.

## 6. Offline labelling (device time)

- An action keeps its mutation UUID, client timestamp and received time.
- The label is the session whose window contains the **device** timestamp.
- **Safeguard:** the device records its clock offset at each successful sync. If the offset is over 2 minutes, or the device has not synced that day, the action is still accepted and labelled but flagged for Executive **review**. An action outside every window is flagged `outside_schedule`. Nothing is dropped and nothing is silently relabelled to the current session.
- Authorisation is checked against current server access; entity relationships are validated; late actions are not rejected because a boundary passed.
- Late acceptance cut-off: until the Executive closes that conference day, then review.
- Schedule versioning (judge by the schedule at action time or at submission) is **open**; the simplest rule is "current schedule at submission", with changes to a past day's schedule requiring an audited re-label action.

## 7. Boundary behaviour devices need

A time boundary produces no database write, so nothing will announce it. Devices keep the schedule and lead times cached and compute the label with a timer, corrected on focus and reconnect. The server stamps its own label; a mismatch is not an error.

## 8. Migration

DCMUN uses a fresh database, so no data migration is needed. Apply as forward migrations on a **staging** project first, under the lock-timeout rules of the reliability proposal, then fold into the DCMUN baseline once contracts settle. Nothing here is applied to any production project.

## 9. Test plan (before merge)

Conformance vectors for the window function, identical in TypeScript and SQL; a speech, a vote and an amendment each spanning a boundary; offline replay at a boundary, with clock offsets above and below tolerance; override precedence; automation off; a break shorter than the lead; overnight; day close and grace; roll-call prompt and copy-last; queue persistence and optional clear; RLS unchanged for chairs (own committee only); a duplicate mutation replay; the existing outbox, idempotency and PT409 tests unchanged.

## 10. Not yet verified

Reports and exports that group by session (awards, participation, archives); every UI use of `currentSessionId`; the effect on the Executive archive and "session used" checks; schedule-versioning semantics; the lead/grace defaults.
