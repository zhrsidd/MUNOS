# Operations extensions (Claude-owned)

New, independent conference-operations systems built around the Codex-owned core. This page describes the current extension contract after Codex integration review. The original review checklist is retained below for traceability; review outcomes and corrections are in [CLAUDE_REVIEW.md](CLAUDE_REVIEW.md).

## Extension pattern

Extensions retain separate read/write RPCs while sharing the core durable outbox. The integrated core additionally implements shared sessions, speech/POI procedure and voting safeguards:

| Layer | Core (Codex) | Extension (Claude) |
| --- | --- | --- |
| Read | `public.conference_snapshot(conf)` | `public.operations_snapshot(conf)` — SECURITY INVOKER, table RLS decides visibility. Since PR #11 the app reads both through **one** bundled `conference_state_snapshot` / `executive_state_snapshot` RPC (which also includes `staff_batch_snapshot`); the separate parallel calls remain only as a fallback when the bundled function is missing. |
| Write | `public.apply_conference_mutation(...)` | `public.apply_operations_mutation(...)` — identical signature and contract: caller authorization via `private.has_access`, idempotent receipt in `private.mutation_receipts`, committee/conference row lock, `audit_log` entry and `operational_changes` notification in one transaction. |
| Client commands | `Command` union in `lib/commands.ts` | `OperationsCommand` in `lib/operations/commands.ts`, joined to the union; `applyCommand` delegates unknown types to `applyOperationsCommand` for optimistic/offline projection. |
| Outbox | `DurableRepository` + `SupabaseTransport` | Unchanged outbox. `SupabaseTransport.send` chooses the RPC by command type. Same UUIDs, same retry, same conflict semantics. |

If the extension migration is not applied, `operations_snapshot` is missing and the transport continues with core data only (extension screens show empty states).

## Resolution submission (Google-Doc-first)

**Product rule: do not rebuild Google Docs.** Delegates write, format, comment on and revise resolutions in Google Docs; Chairs edit there and later type passed amendments into the same document. Conference OS manages the workflow *around* the document: who submitted it and when, its working Google Doc, whether the Chair can open it, whether it has gone to Approval, approval, printing, debate, voting and audit. Conference OS never reads, parses, imports or edits document text.

```
GOOGLE DOCS   authoring · editing · formatting · comments · revision history · applying passed amendments
     ↓
MUNOS         workflow truth: submission, Chair review, approval, printing, debate, voting, audit
     ↓
GOOGLE DRIVE  approval copies · archive · final PDF snapshots (automation later)
```

Google Doc = working document. MUNOS = workflow truth. PDF = snapshot/output/archive.

**Flow.**

1. Delegate writes the resolution in Google Docs and preferably chooses **Anyone with the link → Editor**. If school sharing rules prevent this, the form shows actual assigned Chair names and configured contact emails so the delegate can share directly. Do not invent committee mailboxes.
2. Delegate scans the committee QR → `/submit/{token}` (public, mobile, no account) → country (main submitter), title, **Google Doc link**, ticks “I have made sure the Chairs can edit this document.” → Submit.
3. The server validates the link and calls `public.submit_resolution`, which creates the resolution in the existing **Draft** state (with the Chair) plus a `resolution_links` record (working Google Doc id, submitted time) and notifies the committee's Chair.
4. Chair Console → Documents → **Delegate submissions**: *Open Google Doc* · *Can't access* / *Access fixed* · optional *Approval-folder copy* link · **Submit to Approval** (the existing core `Draft → Submitted` transition).
5. Approval Panel sees it in its inbox with *Open approval copy* (if recorded) and *Open working Google Doc*; the existing workflow continues (Review/Approved → Printed → In Debate → Closed).

**Fallback.** "Can't use Google Docs? Upload a file instead" reveals a PDF/Word upload (≤ 4 MB, checked by extension and file signature). The file is stored in the private `resolutions` bucket first; the Draft is created only after the upload succeeds. Use for exceptional delegates, external documents, or when Google Docs is unavailable.

**Google Doc links.** Accepted: `https://docs.google.com/document/d/<id>/…` (any suffix/query, `/u/<n>/` account paths, missing `https://`). Rejected with a plain explanation: other hosts and look-alikes (`docs.google.com.evil…`, `user@host` tricks, ports), non-HTTP(S) protocols (`javascript:`, `data:`), Drive file links, spreadsheets, "Publish to the web" links (`/d/e/…`, view-only), malformed ids. Only the document **id** (`[A-Za-z0-9_-]{25,100}`) is stored — the database checks the same pattern — and the URL is always rebuilt as `https://docs.google.com/document/d/<id>/edit`, so no arbitrary user-supplied URL is rendered. This currently drops rare legacy `resourcekey` query parameters; preserving those is a low-priority follow-up. Conference OS makes **no Google API calls**; delegates need no Google sign-in with Conference OS. Whether the Chair can open the document is recorded by the Chair (*Can't access*), not verified by Conference OS.

**Approval (manual for now).** The Chair copies the Google Doc into the Approval Panel's Drive folder by hand and may paste that copy's link (optional). Drive automation (copy on *Submit to Approval*, PDF snapshot) is a later Claude integration and is not implemented.

**Security model.**

- One active link per committee (`public.submission_links`); the token is 128 bits of randomness. Possessing it lets someone register a resolution **for that committee only**; it grants no staff-table access. The server deliberately returns only the committee context, country choices and assigned Chair contact details needed for submission (no delegate names or emails).
- The browser never talks to the database for submission. The server route uses `SUPABASE_SECRET_KEY` (server-only) to call two functions executable **only by `service_role`**: `submission_link_info` and `submit_resolution`. No `anon` grants or policies; core RLS unchanged.
- Validation: Google Doc link as above **or** a PDF/DOCX/DOC file (never both), title 3–200 characters, submitter must be a delegate of that committee, a stored file must be inside that committee's folder.
- Abuse limits: 20 accepted submissions per link per 10 minutes; the same Google Doc (or the same file, SHA-256) to the same committee returns the original reference.
- Executive manages actual Chair contact emails in staff records and committee assignments; changing contact metadata does not grant authentication or database access. Legacy `share_with` is temporary compatibility data, not the source of sharing instructions. Executive can **Replace** a leaked link (old QR stops working immediately) or **Turn off** online submission for a committee.
- Pages under `/submit/` send `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `Cache-Control: private, no-store`, and do not open the staff workspace, device storage, a staff session or the service worker.

**Reliability.** Each attempt carries a client UUID; a lost response is retried with the same UUID and returns the original reference (`replayed`). For the fallback, a failed upload creates no Draft. An ambiguous database response retains the uploaded bytes for recovery; cleanup occurs only after a confirmed duplicate with a different canonical storage key. Receipts bind the submitted payload, and retries with changed payloads are rejected. Google Doc submissions keep working while Storage is down.

**What Supabase Storage is for.** Only uploaded fallback files (and, later, snapshots). It is never the authoritative resolution; the working Google Doc is. Path `{conference}/{committee}/{document}/{version}.{ext}`; staff read through a 10-minute signed URL only when the referenced document/version is visible to their role and lifecycle scope; unreferenced objects are not readable. Use *Open uploaded file*.

**Data.** `public.resolution_links` (per resolution): `working_doc_id`, `approval_copy_doc_id`, `access` (`unchecked`/`ok`/`problem`), `submitted_at`. Chairs (own committee) and Executives update it with the `resolutionLink` extension command (`workingDoc`, `approvalCopy`, `access`) through the normal outbox. Chair-created resolutions can also be given a working Google Doc from the document preview.

**Not built (by design).** No document parser, clause import, structured clause editor, text storage, automatic amendment editing, Drive copying or Google OAuth. Future amendment tracking (Codex) only needs "passed, not yet applied" / "applied to the working document" flags on top of this.

**Local demo.** With `NEXT_PUBLIC_DATA_BACKEND=local` the route uses an in-memory demo backend (tokens `demo_<committee>_<hex>`, seed committees only, contact details derived from configured demo staff assignments). Demo submissions do not appear in the browser's local demo workspace; the Chair panel can be exercised by linking a Google Doc to a demo resolution.

**Operator UI.** Executive → *Submission links* (create missing links, view assigned Chair contacts, copy, print sheet, replace, turn off). Configure contact emails under *Chairs/Staff*. Chair Console → Documents → *Delegate submissions* and *Submission QR*. Printable A4 room sheet at `/submit/{token}/sheet`.

## Schedule import

> **Superseded.** Since PR #13 sessions are created centrally in Executive → **Sessions** (`/admin/sessions`) for every active committee; the schedule-import screen below is no longer reachable from the app. Kept as a record of the original review.

**Flow.** Executive → *Schedule import*: upload a CSV/text file or paste rows copied from Excel/Google Sheets → **Preview** → review table (edit date, name, start, end, committees; tick/untick rows) → **Create N sessions** → sessions appear for each committee.

**Supported input.** Comma, semicolon or tab separated (spreadsheet copy-paste), with or without a header row. Columns recognised by header name: Date/Day, Session/Name/Event, Start, End, Time (a single `09:00–10:30` range), Committees. Without a header the order is Date, Session, Start, End, Committees.

- Dates: `2026-11-13`, `13/11/2026` (or `11/13/2026` when *Month/Day/Year* is chosen), `13.11.26`, `Day 2` (counted from the conference date), `Friday`/`Fri 13 Nov`, `13th November 2026`. A blank date repeats the date above; a row with only a date is a day heading.
- Times: `13:30`, `9:00`, `9.00`, `0900`, `9am`, `1:30 pm`. A bare `9` is rejected as ambiguous.
- Committees: `All`, or codes/names separated by commas, `;`, `/`, `&` or "and" (`GA1, SC`, `Security Council`). Empty = the default selection chosen on the first screen (all committees, or a chosen list).
- Not supported: PDF or images. A future parser can produce the same rows.

**Safety.** Lunch, breaks, coffee, registration, prayers, photos and ceremonies are shown but unticked; they are created only if ticked. Unknown committees, unreadable dates/times, end-before-start and missing names block confirmation until fixed or unticked. Duplicates (same committee and start time, or same name on the same day, already in the conference or twice in the import) are skipped and listed. One import creates at most 500 sessions in one atomic command; repeating an import creates nothing new. Times are entered and shown in conference time (`NEXT_PUBLIC_CONFERENCE_TIMEZONE`, default `Asia/Qatar`), independent of a device's own time zone.

**Data.** `sessions."endsAt"` (nullable) is the only core schema addition. Imported sessions are `scheduled`; Chairs explicitly set the shared `currentSessionId`. Schedule times never silently change the operational session. The `sessionImport` command runs through the normal outbox into `apply_operations_mutation`, which notifies each affected committee.

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

## Original shared-architecture review checklist (resolved by integration review)

The table preserves the original review scope, with session decisions and migration paths updated. It is not a list of unreviewed changes. The additive Chair-contact migration `20261006073442_staff_chair_contacts` is applied to development; contact persistence and the service-only assigned-contact projection have been verified.

| # | Item | Why it touches shared architecture | Risk / notes |
| --- | --- | --- | --- |
| 1 | `supabase/migrations/20261006023101_operations_extensions.sql` | New tables (`public.submission_links`, `public.resolution_links`, `private.resolution_submissions`), new functions, Storage bucket + `storage.objects` read policy | Additive only. No existing table/policy/function altered. All new tables have RLS; no `anon` grants. `submit_resolution` inserts into `documents` (status **Draft**), `document_versions` (placeholder text pointing to the Google Doc; `storageKey` only for fallback files) and `operational_changes` as definer — review against core invariants (code uniqueness, session choice). `resolution_links` has a composite FK to `documents(id, conference_id, committee_id)`. |
| 2 | `lib/domain.ts` — `ConferenceData extends OperationsData` | Shared domain type | Optional fields only. |
| 3 | `lib/commands.ts` — `OperationsCommand` in `Command`, `operationsRoles` in `allowed`, `default:` delegation | Shared command model | Core cases untouched. Audit label for extension commands uses the existing generic `"<type> updated"`. |
| 4 | `lib/supabase/repository.ts` — parallel `operations_snapshot` read, RPC routing in `send` | Repository/transport contract | Two RPCs per read instead of one (the second is small). Missing function tolerated. |
| 5 | `app/layout.tsx` — `ConferenceShell` instead of `ConferenceProvider` | App shell | Identical behaviour except `/submit/*` renders without the staff provider. |
| 6 | `components/offline-shell.tsx` | Service worker registration | Skipped on `/submit/*` only. |
| 7 | `components/documents.tsx` — preview caption | Existing document UI | Replaced the "text preview only" caption with `ResolutionSources`: *Open working Google Doc*, *Open approval copy*, *Open uploaded file*, or (Chair) *Link Google Doc*. The paper text preview is unchanged. |
| 8a | Delegate submissions enter **Draft** (not Submitted) | Core workflow semantics | Matches the real DCMUN process: Chair reviews, copies to the Approval folder, then uses the existing Chair `Draft → Submitted` transition ("Submit to Approval"). No new states. |
| 8b | `components/workspace.tsx` — `DelegateSubmissions` panel on Chair → Documents | Existing Chair UI | Additive panel above the existing documents list; only shown when delegate submissions are waiting. |
| 8 | Session chosen for a delegate submission | Core session semantics | `submit_resolution` uses the authoritative committee current session, which may be null. Starting debate requires an explicit current session; there is no date-based fallback. |
| 9 | `supabase/migrations/20261006023104_session_schedule_import.sql` — `public.sessions."endsAt"` + check constraint + `(committee_id, "startsAt")` index | Core table column | Nullable; existing commands and snapshot unaffected (snapshot serializes all columns). Also refactors Claude's own `apply_operations_mutation` into per-command handlers. |
| 10 | `lib/domain.ts` — `Session.endsAt?` | Shared domain type | Optional. |
| 11 | Imported sessions and the Chair's "current session" | Shared Chair/session state | Imported sessions are `scheduled`. The Chair explicitly selects the authoritative shared current session; timestamps may suggest a choice but never override it. |
| 12 | `supabase/migrations/20261006023106_photo_schedule.sql` | New staff-readable tables (`photo_slots`: all staff roles incl. committee-scoped chairs; `photo_acknowledgements`: admin + that committee's chair) and a replacement of Claude's `operations_snapshot` / `apply_operations_mutation` | No core table changes. Chairs can read every photo slot (school, time, location) — not personal data, needed to derive reminders. |
| 13 | `public/sw.js` — `/chair/photos` added to the offline shell, cache version bumped to `conference-os-0.2.1` | Offline architecture | One extra shell path; old cache is replaced on activation as before. |

## Rehearsal boundary

MUNOS is staff-only. Public submission routes create no Supabase Auth session. Rehearse staff-app reads/writes/reconnect and device enrollment separately from delegate QR-form HTTP bursts. The recorded 150-client staff load reused one authorized identity and does not test QR submission capacity. Real HTTP submission and fallback upload verification require the server-only development secret; direct SQL submission tests are not a substitute. Future Drive automation credentials are separate from human Chair contacts.
