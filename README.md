# DCMUN Conference OS

Next.js App Router, TypeScript and Supabase conference operations. The DCMUN-branded frontend provides Chair, Approval, Admins and Executive workspaces. This is a **development baseline, not a conference-ready production release**.

## Start

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The example defaults to an isolated local demo. For the development database, set `NEXT_PUBLIC_DATA_BACKEND=supabase`, the project URL/publishable key, and conference UUID. Never use a secret/service-role key in browser configuration. See [INTEGRATION.md](INTEGRATION.md) for session provisioning and schema setup. Node 22+ recommended; dependencies and the lockfile are pinned.

## Current implementation

- Remote normalized schema, strict RLS, explicit read grants and validated transactional command RPCs.
- Explicit, shared current-session selection; independent open/for/against speaker queues, recognized POIs, Main/Co-Submitter speech flow, Divide the House and configurable Security Council veto rules.
- Attendance per session; event-derived opportunities and quality points; configurable scoring; immutable participation corrections and document versions.
- Resolution workflow around Google Docs: delegates register their Google Doc via a committee QR link, the Chair reviews it in Google Docs and submits it to Approval; review, approval, printing, debate, attendance-aware voting, configured majority outcome and audit records. Conference OS does not edit document text.
- IndexedDB saves before optimistic rendering. Cloud writes use a durable mutation outbox with stable UUIDs, retry receipts and explicit revision conflicts.
- Local countdown calculation; timer transitions alone are persisted. Realtime is limited to operational notifications; ordinary reads/writes and periodic recovery work independently.
- Production-only service worker caches the Chair shell. Executive System health shows connection, latency, pending changes and recovery export.
- MUNOS is staff-only. Delegates use the isolated, server-mediated QR submission form without creating Supabase Auth sessions. Prefer Google Docs “Anyone with the link → Editor”; assigned Chair contacts provide the sharing fallback.
- Award rubric controls are retired; alphabetical participation context supports a human Chair decision.
- Local demo data is separate from cloud data and is never automatically uploaded.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Role entry for granted workspaces; a device without a grant sees the staff access-code gate |
| `/chair` | Debate, speakers, timer, scoring and suggestions |
| `/chair/{roll-call,participation,documents,amendments,voting,awards}` | Chair operations |
| `/chair/photos` | This committee's school group-photo slots (reminders appear on every Chair screen) |
| `/approval` | Review inbox |
| `/logistics` | Print queue |
| `/admin` | Conference overview |
| `/admin/{conference,committees,sessions,delegates,schools,staff,scoring,workflow,resources,audit}` | Configuration (`/admin/sessions` = central session schedule) |
| `/admin/{access-codes,submissions,amendment-links}` | Staff access codes, resolution QR links, amendment QR links |
| `/{chair,approval,logistics,admin}/health` | GREEN/YELLOW/RED system health, version, recovery — in every staff workspace |
| `/submit/{token}`, `/amend/{token}` | Public delegate QR forms (no sign-in) |
| `/admin/schedule` | Import the conference schedule as sessions |
| `/admin/photos` | School group-photo slots, CSV import, chair acknowledgements |
| `/admin/submissions` | Committee resolution-submission links / QR codes |
| `/submit/{token}` | Public, mobile page where delegates register their Google Doc resolution with the Chair (no account; file upload fallback) |
| `/submit/{token}/sheet` | Printable committee room sheet with QR code |
| `/api/health` | Build identity and Supabase/Storage reachability (JSON) |
| `/projector` | Lightweight display |

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm start -- --port 3001
```

`npm test` includes a fresh PostgreSQL-compatible PGlite migration/RLS test, durable IndexedDB failure tests and existing workflow tests. These do not substitute for remote Supabase verification. Remote scripts require explicitly authorized, short-lived development sessions in ignored `.test-sessions/`; they never use a service key. The public submission server additionally requires `SUPABASE_SECRET_KEY`, kept server-only. Its real HTTP/Storage path was verified against the development project (see the integration review). See [integration review](docs/INTEGRATION_REVIEW.md), [verification status](docs/VERIFICATION.md), [load results](docs/load-test-results.json) , the [organizer runbook](CONFERENCE_RUNBOOK.md), [emergency sheet](docs/EMERGENCY_RECOVERY.md) and [troubleshooting](docs/TROUBLESHOOTING.md).

## Deployment

Vercel Preview for every branch/PR **and for `main`**; Production only from the `production` branch, advanced deliberately; CI on every PR; build identity on every screen and `/api/health`, production freeze and rollback: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the [release record](docs/RELEASES.md). `npm run verify:deployment -- <url>` checks a deployed URL. Release gates: [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md). Staff practice: [docs/STAFF_REHEARSAL.md](docs/STAFF_REHEARSAL.md). Conference-week load rehearsal: [docs/STAGING_REHEARSAL.md](docs/STAGING_REHEARSAL.md) (`npm run rehearsal:plan`, guarded `npm run rehearsal:run`). Drive design: [docs/GOOGLE_DRIVE_ARCHITECTURE.md](docs/GOOGLE_DRIVE_ARCHITECTURE.md) (`npm run drive:plan`, dry run).

## Deferred

Google Drive automation (Approval-folder copies, PDF snapshots, archive), production Supabase setup, the conference-week load rehearsal on Supabase Pro/Small (including school-network enrollment) and an actual Vercel rollback rehearsal. Document previews are text and printing is an operator confirmation. Award decisions remain human. Feature toggles currently store configuration rather than disabling every workflow. See [backlog](docs/BACKLOG.md).

Operations extensions (resolution submission, group-photo reminders; the earlier schedule import is superseded by central sessions) and their Codex review items: [docs/OPERATIONS_EXTENSIONS.md](docs/OPERATIONS_EXTENSIONS.md). Organizer runbook: [CONFERENCE_RUNBOOK.md](CONFERENCE_RUNBOOK.md). Reliability review: [docs/RELIABILITY.md](docs/RELIABILITY.md).

GitHub `zhrsidd/MUNOS` is the shared source of truth. See [AGENTS.md](AGENTS.md) for ownership and review boundaries.
