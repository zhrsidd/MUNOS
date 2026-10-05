# DCMUN Conference OS

Next.js App Router, TypeScript and Supabase conference operations. The DCMUN-branded frontend provides Chair, Approval, Logistics and Administrator workspaces. This is a **development baseline, not a conference-ready production release**.

## Start

```sh
npm ci
cp .env.example .env.local
npm run dev
```

The example defaults to an isolated local demo. For the development database, set `NEXT_PUBLIC_DATA_BACKEND=supabase`, the project URL/publishable key, and conference UUID. Never use a secret/service-role key in browser configuration. See [INTEGRATION.md](INTEGRATION.md) for session provisioning and schema setup. Node 22+ recommended; dependencies and the lockfile are pinned.

## Current implementation

- Remote normalized schema, strict RLS, explicit read grants and validated transactional command RPCs.
- Attendance per session; event-derived opportunities and quality points; configurable scoring; immutable participation corrections and document versions.
- Resolution submission, review, approval, printing, debate, attendance-aware voting, configured majority outcome and audit records.
- IndexedDB saves before optimistic rendering. Cloud writes use a durable mutation outbox with stable UUIDs, retry receipts and explicit revision conflicts.
- Local countdown calculation; timer transitions alone are persisted. Realtime is limited to operational notifications; ordinary reads/writes and periodic recovery work independently.
- Production-only service worker caches the Chair shell. Administrator System health shows connection, latency, pending changes and recovery export.
- Local demo data is separate from cloud data and is never automatically uploaded.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Role entry; access-code screens are deferred |
| `/chair` | Debate, speakers, timer, scoring and suggestions |
| `/chair/{roll-call,participation,documents,voting,awards}` | Chair operations |
| `/approval` | Review inbox |
| `/logistics` | Print queue |
| `/admin` | Conference overview |
| `/admin/{conference,committees,sessions,delegates,schools,staff,scoring,awards,workflow,resources,audit}` | Configuration |
| `/admin/health` | GREEN/YELLOW/RED system health, version, recovery |
| `/admin/submissions` | Committee resolution-submission links / QR codes |
| `/submit/{token}` | Public, mobile resolution submission for delegates (no account) |
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

`npm test` includes a fresh PostgreSQL-compatible PGlite migration/RLS test, durable IndexedDB failure tests and existing workflow tests. These do not substitute for remote Supabase verification. Remote scripts require explicitly authorized, short-lived development sessions in ignored `.test-sessions/`; they never use a service key. See [verification status](docs/VERIFICATION.md), [load results](docs/load-test-results.json) and [organizer runbook](docs/OPERATIONS.md).

## Deployment

Vercel Preview for every branch/PR, Production from `main`, CI on every PR, build identity on every screen and `/api/health`, production freeze and rollback: see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the [release record](docs/RELEASES.md). `npm run verify:deployment -- <url>` checks a deployed URL.

## Deferred

Actual PDFs/Storage, Google Drive mirroring, access-code redemption, production Supabase setup, school-network enrollment/load rehearsal and an actual Vercel rollback rehearsal. Document previews are text and printing is an operator confirmation. Award decisions remain human. Feature toggles currently store configuration rather than disabling every workflow. See [backlog](docs/BACKLOG.md).

Operations extensions (resolution submission, schedule import, group-photo reminders) and their Codex review items: [docs/OPERATIONS_EXTENSIONS.md](docs/OPERATIONS_EXTENSIONS.md). Organizer runbook: [CONFERENCE_RUNBOOK.md](CONFERENCE_RUNBOOK.md).

GitHub `zhrsidd/MUNOS` is the shared source of truth. See [AGENTS.md](AGENTS.md) for ownership and review boundaries.
