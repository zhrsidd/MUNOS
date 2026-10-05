# Operations extensions (Claude-owned)

New, independent conference-operations systems built around the Codex-owned core. This page is the contract between the two: what was added, how it plugs in, and every item marked **CODEX REVIEW REQUIRED**.

## Extension pattern

The core (schema, `conference_snapshot`, `apply_conference_mutation`, `lib/commands.ts`, the offline outbox) is **not modified in behaviour**. Extensions plug in beside it:

| Layer | Core (Codex) | Extension (Claude) |
| --- | --- | --- |
| Read | `public.conference_snapshot(conf)` | `public.operations_snapshot(conf)` — SECURITY INVOKER, table RLS decides visibility. The transport calls both in parallel and merges the result into `ConferenceData` (optional fields). |
| Write | `public.apply_conference_mutation(...)` | `public.apply_operations_mutation(...)` — identical signature and contract: caller authorization via `private.has_access`, idempotent receipt in `private.mutation_receipts`, committee/conference row lock, `audit_log` entry and `operational_changes` notification in one transaction. |
| Client commands | `Command` union in `lib/commands.ts` | `OperationsCommand` in `lib/operations/commands.ts`, joined to the union; `applyCommand` delegates unknown types to `applyOperationsCommand` for optimistic/offline projection. |
| Outbox | `DurableRepository` + `SupabaseTransport` | Unchanged outbox. `SupabaseTransport.send` chooses the RPC by command type. Same UUIDs, same retry, same conflict semantics. |

If the extension migration is not applied, `operations_snapshot` is missing and the transport continues with core data only (extension screens show empty states).

## Resolution submission

**Flow.** Delegate scans the committee QR → `/submit/{token}` (public, mobile) → chooses country (main submitter), title, PDF/Word file → `POST /api/submissions` → the server stores the file in the private `resolutions` bucket → `public.submit_resolution` creates the resolution **directly in the existing `Submitted` state** with version 1 pointing at the stored file → `operational_changes` (topic `documents`) notifies the committee's Chair and the Approval Panel → Approval continues with the normal workflow (Review/Approved/Draft → Printed → In Debate → Closed). No new state machine.

**Security model.**

- One active link per committee (`public.submission_links`, unique partial index). The token is 128 bits of randomness (22 URL-safe characters); links cannot be enumerated or guessed.
- Possessing a link lets someone submit **to that committee only**. It cannot read anything: the page shows only committee name and country names (no delegate names or emails).
- The browser never talks to the database for submission. The server route uses `SUPABASE_SECRET_KEY` (server-only) to call two functions executable **only by `service_role`**: `submission_link_info` and `submit_resolution`. No `anon` grants, no new policies for `anon`, RLS unchanged.
- Validation: PDF/DOCX/DOC by extension **and** file signature, ≤ 4 MB (Vercel's body limit is 4.5 MB), title 3–200 characters, submitter must be a delegate of that committee, storage key must be inside that committee's folder.
- Abuse limits: 20 accepted submissions per link per 10 minutes; identical file (SHA-256) to the same committee returns the original reference instead of a new resolution.
- Executive can **Replace** (rotate) a leaked link — the old QR stops working immediately — or **Turn off** online submission for a committee.
- Pages under `/submit/` send `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and `Cache-Control: private, no-store`. They do not open the staff workspace, device storage, a staff session or the service worker.

**Reliability.** The file is stored first; the resolution is created only after a successful upload (a failed upload creates nothing). Each attempt carries a client UUID; a lost response is retried with the same UUID and returns the original reference (`replayed`). If the database step fails, the uploaded object is removed (best effort).

**Files.** Path `{conference}/{committee}/{document}/{version}.{pdf|docx|doc}`. Staff with access to that committee (admin/chair/approval/logistics) read through a 10-minute signed URL (`Open submitted file` in the document preview).

**Local demo.** With `NEXT_PUBLIC_DATA_BACKEND=local` the route uses an in-memory demo backend (tokens `demo_<committee>_<hex>`, seed committees only) so the page can be exercised without Supabase. Demo submissions do not appear in the browser's local demo workspace.

**Operator UI.** Executive → *Submission links* (create missing, copy, print sheet, replace, turn off, fallback contact). Chair Console → Documents → *Submission QR* (QR, copy link, print room sheet). Printable A4 room sheet at `/submit/{token}/sheet`.

## Schedule import

**Flow.** Executive → *Schedule import*: upload a CSV/text file or paste rows copied from Excel/Google Sheets → **Preview** → review table (edit date, name, start, end, committees; tick/untick rows) → **Create N sessions** → sessions appear for each committee.

**Supported input.** Comma, semicolon or tab separated (spreadsheet copy-paste), with or without a header row. Columns recognised by header name: Date/Day, Session/Name/Event, Start, End, Time (a single `09:00–10:30` range), Committees. Without a header the order is Date, Session, Start, End, Committees.

- Dates: `2026-11-13`, `13/11/2026` (or `11/13/2026` when *Month/Day/Year* is chosen), `13.11.26`, `Day 2` (counted from the conference date), `Friday`/`Fri 13 Nov`, `13th November 2026`. A blank date repeats the date above; a row with only a date is a day heading.
- Times: `13:30`, `9:00`, `9.00`, `0900`, `9am`, `1:30 pm`. A bare `9` is rejected as ambiguous.
- Committees: `All`, or codes/names separated by commas, `;`, `/`, `&` or "and" (`GA1, SC`, `Security Council`). Empty = the default selection chosen on the first screen (all committees, or a chosen list).
- Not supported: PDF or images. A future parser can produce the same rows.

**Safety.** Lunch, breaks, coffee, registration, prayers, photos and ceremonies are shown but unticked; they are created only if ticked. Unknown committees, unreadable dates/times, end-before-start and missing names block confirmation until fixed or unticked. Duplicates (same committee and start time, or same name on the same day, already in the conference or twice in the import) are skipped and listed. One import creates at most 500 sessions in one atomic command; repeating an import creates nothing new. Times are entered and shown in conference time (`NEXT_PUBLIC_CONFERENCE_TIMEZONE`, default `Asia/Qatar`), independent of a device's own time zone.

**Data.** `sessions."endsAt"` (nullable) is the only core schema addition. Imported sessions are `scheduled`; the core's session selection is unchanged. The `sessionImport` command runs through the normal outbox into `apply_operations_mutation`, which notifies each affected committee.

## School group photos and chair reminders

**Model.** `public.photo_slots` (school, start, optional end, location, note, active/cancelled, warning minutes, revision) and `public.photo_acknowledgements` (committee, slot, stage `warning`/`due`, slot revision). Delegate → school → committee comes from the existing delegate records; nothing is duplicated.

**Who is reminded.** For a slot, the committees with at least one delegate from that school. Executive → *Group photos* shows each slot with e.g. `GA1 · 2  WHO · 1  HRC · 3` and acknowledgement status (✓ warned, ✓✓ delegates sent).

**Reminder behaviour (Chair Console, every screen).**

| Time | Banner | Action |
| --- | --- | --- |
| before start − warning (default 10 min) | none (listed under *Group photos*) | — |
| from start − warning | **GROUP PHOTO IN N MINUTES** · school · time · location · "N delegates from this committee should attend" | View delegates · Acknowledge |
| from start until end (or start + 15 min) | **GROUP PHOTO NOW** · "Please send these delegates to {location}" with country and name | Delegates sent |
| after end | none (listed as Done) | — |
| cancelled, during its window | **GROUP PHOTO CANCELLED** · delegates do not need to leave | Dismiss |

Acknowledging the warning hides it until the photo is due; "Delegates sent" hides the due banner. Acknowledgements are per committee and shared by every device in that committee.

**Reliability.** Reminders are **derived on each device** from slot timestamps and the device clock every 15 seconds — no server request, no one-off push. A refreshed, reconnected, offline or late-opened Chair Console computes the same reminders from its cached snapshot. Realtime only makes schedule changes arrive sooner; without it the regular recovery read (≤ 60 s) delivers them. A reschedule increments the slot revision, so earlier acknowledgements stop counting and chairs are alerted again. Acknowledgements go through the normal offline outbox. Times are stored as instants and shown in conference time; only the device's clock (not its time zone) must be right. Browser push notifications are not used.

**Import.** Executive → Group photos → *Import CSV*: `school,date,start_time,end_time,location[,note]`. School names are matched against existing schools after normalizing case, accents, punctuation, `&`/"and" and spacing (`"Doha College "` → Doha College). Near misses (`"Doha Collge"`) are offered as a suggestion that must be confirmed; unknown names must be chosen or the row unticked. Schools are never created by the import. Same school + start time as an existing slot is skipped.

## CODEX REVIEW REQUIRED

| # | Item | Why it touches shared architecture | Risk / notes |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/20261006090000_operations_extensions.sql` | New tables (`public.submission_links`, `private.resolution_submissions`), new functions, Storage bucket + `storage.objects` read policy | Additive only. No existing table/policy/function altered. All new tables have RLS; no `anon` grants. `submit_resolution` inserts into `documents`/`document_versions`/`operational_changes` as definer — review that the direct `Submitted` insert matches core invariants (code uniqueness, session choice). |
| 2 | `lib/domain.ts` — `ConferenceData extends OperationsData` | Shared domain type | Optional fields only. |
| 3 | `lib/commands.ts` — `OperationsCommand` in `Command`, `operationsRoles` in `allowed`, `default:` delegation | Shared command model | Core cases untouched. Audit label for extension commands uses the existing generic `"<type> updated"`. |
| 4 | `lib/supabase/repository.ts` — parallel `operations_snapshot` read, RPC routing in `send` | Repository/transport contract | Two RPCs per read instead of one (the second is small). Missing function tolerated. |
| 5 | `app/layout.tsx` — `ConferenceShell` instead of `ConferenceProvider` | App shell | Identical behaviour except `/submit/*` renders without the staff provider. |
| 6 | `components/offline-shell.tsx` | Service worker registration | Skipped on `/submit/*` only. |
| 7 | `components/documents.tsx` — preview caption | Existing document UI | Shows *Open submitted file* when a version has a `storageKey`. |
| 9 | `supabase/migrations/20261006100000_session_schedule_import.sql` — `public.sessions."endsAt"` + check constraint + `(committee_id, "startsAt")` index | Core table column | Nullable; existing commands and snapshot unaffected (snapshot serializes all columns). Also refactors Claude's own `apply_operations_mutation` into per-command handlers. |
| 10 | `lib/domain.ts` — `Session.endsAt?` | Shared domain type | Optional. |
| 11 | Imported sessions and the Chair's "current session" | Chair/session state (Codex backlog item) | Imported sessions are `scheduled`. The Workspace still defaults to an `active` session or the first session; Codex's planned "Chair sets current session" should consider `startsAt`/`endsAt` for its default. |
| 12 | `supabase/migrations/20261006110000_photo_schedule.sql` | New staff-readable tables (`photo_slots`: all staff roles incl. committee-scoped chairs; `photo_acknowledgements`: admin + that committee's chair) and a replacement of Claude's `operations_snapshot` / `apply_operations_mutation` | No core table changes. Chairs can read every photo slot (school, time, location) — not personal data, needed to derive reminders. |
| 13 | `public/sw.js` — `/chair/photos` added to the offline shell, cache version bumped to `conference-os-0.2.1` | Offline architecture | One extra shell path; old cache is replaced on activation as before. |
| 8 | Session chosen for a delegate submission | Core session semantics | `submit_resolution` picks: active session → latest started → first scheduled. When Codex adds "Chair sets current session", switch this to that value. |
