# Engineering guide for MUNOS / DCMUN Conference OS

GitHub `zhrsidd/MUNOS` is the source of truth. `main` is the stable baseline.

## Ownership

**Claude is the primary software engineer for the whole application**: frontend, business logic, the repository
layer, Supabase schema and migrations, RLS and access control, offline sync, performance and reliability, plus
integrations, Vercel, deployment, monitoring and operations. Who first wrote a piece of code (including code
originally built by Codex) does not restrict who may change it. Do not treat any feature as off limits.

**Codex provides independent review, verification and specialist support.** Every change in a protected area
below gets a second reviewer's read before it ships; Claude does not approve its own protected-area changes.

The owner (Zuhayr Siddique) decides product scope. John Paul Ribeiru approves releases. During a live problem at
the conference, Zuhayr Siddique is in charge.

## Protected areas: extra care, independent review

These are not ownership restrictions. They are places where a mistake costs a conference day, so each needs a
reviewed, tested change.

1. **Production and environments.** MUNOS uses **one hosted Supabase project** with a lifecycle of Development,
   Final rehearsal, Cutover and Production ([docs/INFRASTRUCTURE_LIFECYCLE.md](docs/INFRASTRUCTURE_LIFECYCLE.md)).
   Do not provision a second hosted project or paid database branch without the owner's approval. The same
   project is formally promoted to production before any actual conference data is entered; after promotion,
   cloud agents have no live database access (source review and local synthetic tests only). Use local
   disposable Postgres for destructive tests. The PHESMUN production project is forbidden everywhere
   (`lib/platform/target-guard.ts`). Production builds must target exactly `EXPECTED_SUPABASE_REF`. Do not point
   load tests, rehearsals or scripts at anything not listed as staging or development. The lifecycle gates
   (production lock, owner-controlled registry, production-only write gateway, revocation proof) are required
   but **not yet implemented**; see [docs/V1_RELEASE_CHECKLIST.md](docs/V1_RELEASE_CHECKLIST.md). Do not change
   Vercel production configuration without the owner's approval.
2. **Secrets.** Never commit secrets, session tokens, service keys or generated build output. Never print
   credentials in logs, tests, docs or chat. Keep server-only keys out of client bundles.
3. **Migrations and schema.** Apply schema changes only through committed migrations in `supabase/migrations`,
   replayed from empty on local disposable Postgres; the initial promotion also requires verification in the
   preproduction phase of the single hosted project. After promotion, later migrations are independently
   reviewed, replayed from empty locally, checked for backward compatibility and applied through an authorised
   human-controlled release, without re-enabling cloud-agent hosted testing. Never edit an applied migration. One person substantially
   changes schema, RLS, auth, shared domain types or repository contracts at a time; announce it and have it
   reviewed.
4. **Access control.** Do not widen RLS or role permissions for development convenience. Access revocation takes
   effect immediately. Chair, Approval Panel, printing and Executive permissions stay separate. Any UI that
   hides a control is not the permission; the server-side rule is.
5. **Offline data.** Preserve the independent IndexedDB outbox and the server idempotency contract (mutation
   receipts, optimistic fingerprints, PT409/40001 handling). A saved action must never be silently lost or
   applied twice. Do not bypass the outbox with direct writes.

## Working rules

- Inspect existing changes before editing. Match the surrounding code's naming, comment density and idiom.
- Never force-push shared history. Do not open pull requests unless the owner asks.
- Keep commits small and reviewable. State verification honestly: tests, typecheck, lint, build and, for UI, a
  real browser check. If something was not verified, say so.
- Before declaring UI work done, run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
- Parallelise independent work. Serialise shared architecture.

## Design system

`docs/BRAND.md` is authoritative for all UI: palette, typography, spacing, components and information
hierarchy. Use its tokens in `app/globals.css`; do not introduce one-off colours or sizes. Update the document
in the same change when the system changes.

## Plans and deferred work

- `docs/UI_OVERHAUL.md`: approved UI and quality-of-life plan with order, dependencies and acceptance checks.
- `docs/SESSION_MODEL.md`: session model contract (draft, pending review; do not migrate sessions until signed
  off).
- `docs/BACKLOG.md`: remaining product and release work.
- Conference-week validation on Supabase Pro with Small compute (110-device, 19-committee rehearsal, Realtime
  and read-path limits, rollback drills) stays outstanding and is a release gate, not part of UI work.
