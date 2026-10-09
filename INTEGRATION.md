# Integration and reliability

## Environment and deployment scope

Development only: `opmydpozhdgkpcnjwpqb` (Mumbai). No production project exists. `.env.local` is ignored. `.env.example` contains placeholders. Only URL, publishable key, conference UUID and non-secret mode/version flags belong in `NEXT_PUBLIC_*`.

The local Supabase CLI may be signed into another account. Remote schema work was performed through the authenticated Supabase connector, explicitly scoped to the project above. Reauthenticate the CLI before using linked commands; do not change project references to work around permissions.

## Database

31 public tables: the 24 foundation tables plus submission_links, resolution_links, photo_slots, photo_acknowledgements, debate_states, speeches and poi_queue. Private tables include access_credentials, mutation_receipts and resolution_submissions. The last recorded remote inspection found 94 public foreign keys, 39 check constraints and 205 indexes; contact migration verification is tracked separately in [the integration review](docs/INTEGRATION_REVIEW.md).

UUID keys, composite foreign keys constrain conference/committee relationships, attendance is unique per delegate/session, active queue entries are unique, and a committee can have only one document in debate. No participation aggregate columns exist. Historical participation corrections append; originals remain intact. Enum labels currently match the UI's title-case wording. Legacy award tables are retained for history; award-rubric editing and scoring are retired. The current Chair aid shows factual participation context and leaves awards to human judgment.

## Migrations and seed

The ordered files in `supabase/migrations/` are the source of truth. Applied version numbers are aligned with remote migration history. Compare the project migration ledger before applying anything; never replay an applied migration. Apply the ordered set to a fresh project only. The additive staff-contact migration `20261006073442_staff_chair_contacts` was applied once to development and remote types were regenerated. `supabase/seed.sql` is development-only, reproducible, and includes GA1, WHO, HRC, SC and France / Mohammad Maaz. All emails are synthetic example.com addresses. `npm run seed:generate` regenerates it deterministically. Running the seed again does not overwrite existing records.

`npm run test:database` builds a fresh database, applies migrations and tests authorization/commands. `supabase/tests/remote-rls.sql` exercises the real database in a rollback transaction. Generated remote TypeScript definitions live in `lib/supabase/database.types.ts`.

## Authorization

The application is staff-only. Anonymous authentication currently bootstraps a staff device identity only; delegates never create Supabase Auth sessions. Delegate QR routes bypass the staff provider and use a server-mediated, committee-token submission boundary. `user_access` grants conference, role and optional committee; grants expire and may be revoked. Chair grants require a committee. UI role switching cannot grant database privileges. Every public table has RLS; anonymous callers have no table grants; authenticated users have SELECT only. Writes use `apply_conference_mutation` and its explicitly authorized private transaction boundary. Browser clients cannot edit access grants, receipts or audit records directly.

Private SECURITY DEFINER helpers have pinned search paths, explicit caller checks and restricted execution. The public wrapper and snapshot are SECURITY INVOKER. Read policies check current, non-expired grants. A cached-grant experiment was reverted after a failed sustained-load run; its migration history is preserved. Approval/Logistics document access is restricted by lifecycle state. Access credential hashes remain in a private schema with no browser access.

Dashboard: Authentication → Sign In / Providers → Anonymous Sign-Ins must be enabled (development and production). Since PR #12/#13 a first browser visit creates **no** identity: the staff access-code gate creates (or reuses) the device's anonymous identity only when a code is submitted, and `redeem_access_code` creates the scoped grant. Executive codes are issued from Executive → Access codes; the very first Executive on a new project is bootstrapped once with a short-lived Executive access code created out of band (docs/FIRST_EXECUTIVE_BOOTSTRAP.md); no grant is inserted by hand. Never add self-enrollment or blanket anon policies. Existing dev verification users were granted temporary access only.

## Repository and transactions

Components consume the provider/repository, not Supabase queries. `lib/commands.ts` contains optimistic domain validation, commands and selectors. `SupabaseConferenceRepository` wraps `SupabaseTransport` and `DurableRepository`. The local demo uses the same command model and its own isolated checkpoint. The database independently validates every command and binds its receipt to caller, conference, UUID and payload.

An atomic RPC performs authorization, the domain write, audit entry, receipt and operational notification. Duplicate retries return the original success without another write. Attendance, timer, ballot, document and event edits compare revisions. Queue advance identifies the expected first entry; queue insert ordering is generated by the database. Short committee-scoped locks protect cross-record vote/attendance and queue rules while independent committees proceed independently. Closing a vote validates complete eligible ballots and derives simple-majority or two-thirds outcome (excluding abstentions); withdrawal is explicit. Configured Security Council permanent-member delegate IDs enforce vetoes only for substantive votes and present members voting Against. Procedural votes are exempt. Divide the House rejects abstentions. `committees.currentSessionId` is the authoritative shared session; imported timestamps suggest context but do not switch it. Independent queue ordering and POI allowance changes persist without generating gesture-level audit noise; recognized POIs and scored speeches create participation events. Main-Submitter credit is awarded once per resolution and Co-Submitter speech requires a yield from the Main Submitter.

## Offline recovery

IndexedDB `conference-os-v3` stores an authoritative checkpoint and an ordered outbox keyed by conference/user. An action UUID is committed locally before the optimistic UI changes. Acknowledgement and updated snapshot are committed together; lost responses retry the same UUID. A conflict is retained for operator review and blocks subsequent sends. Export recovery data before dismissing a conflicting action. Device exports contain personal information and must be protected.

Previously opened Chair routes and assets are cached by the production service worker; Supabase/Auth/API responses are not cached by that worker. Data is in IndexedDB. No service worker is registered in development mode. First prepare the production preview online. Offline context preferences are also in IndexedDB. Confirmed cloud caches older than seven days are pruned; pending changes are never automatically erased. A previously validated identity can reopen offline within a bounded 48-hour authorization lease (or earlier grant expiry). Shared laptops must clear confirmed data after the conference; never clear data while pending operations remain.

Realtime subscribes only to `operational_changes`, filtered to authorized committee scopes or the conference. Subscription reconnection triggers authoritative refetch. Focus/online signals and jittered 60-second recovery reads cover missed notifications. Retry backoff caps at 60 seconds. Timer ticks never hit the server or Realtime. Multi-tab writes use IndexedDB transactions; sync uses Web Locks where available and server idempotency everywhere.

## Capacity and same-IP startup

Supabase documents anonymous creation at 30 requests/IP/hour by default, configurable, with burst capacity tied to the configured value. This affects fresh staff-device enrollment, not delegates scanning QR forms. Fresh staff enrollment at conference scale is not accepted by default. Reuse sessions and pre-provision/test conference devices before opening. The future access-code exchange must authorize a stable identity, handle replacement laptops deliberately, and avoid a new anonymous signup for every navigation. Review current project limits, configure sufficient measured headroom, and test actual school NAT before release. Never use permissive RLS or client-controlled forwarded IPs as a workaround.

The included 150-client test uses one pre-provisioned identity to exercise operational database/Realtime load. It is explicitly **not** a 150-distinct-user enrollment test. Tail latency and school-network staff enrollment remain release gates. Delegate QR-form bursts require a separate HTTP/server/Storage rehearsal and do not consume anonymous signup capacity. Prepare isolated fixture SQL with `scripts/prepare-load.mts`, apply only to the guarded development project, then run `npm run test:load`. Sessions/fixture setup files stay ignored. Reports record p50/p95/p99, errors, duplicate counts and reconnect counts. Resource pressure requires Supabase Observability; Data API does not expose CPU.

## Next integrations

Documents: **Google Docs is the resolution editor; Conference OS tracks the workflow around it** and never stores or parses document text. Delegate submissions register the working Google Doc id (see [docs/OPERATIONS_EXTENSIONS.md](docs/OPERATIONS_EXTENSIONS.md)). Storage: private bucket `resolutions` holds only the optional PDF/Word upload fallback (and future snapshots), at `{conference}/{committee}/{document}/{version}.{ext}`, with a scoped staff read policy and signed reads; upload first, then create the Draft, so a failed upload never advances the workflow. Chair-created versions remain text placeholders.

Sharing: prefer “Anyone with the link → Editor”. If school restrictions prevent this, show the actual assigned Chairs’ names and configured contact emails, derived from staff assignments; do not fabricate committee mailboxes or treat legacy `share_with` as authoritative. The form confirmation is “I have made sure the Chairs can edit this document.” Staff email is contact metadata, not an access grant or authentication identity. The contact migration is applied; a browser save/reload and remote assigned-contact lookup passed. The temporary test contact was then cleared.

Drive (design only, not implemented): Supabase stays the live record; Google Docs holds editable resolution text; a conference-owned Shared Drive holds Approval copies, PDF snapshots and generated read-only exports. Drive side effects run as retryable, idempotent jobs after the Supabase change commits, so a Drive failure never blocks the conference. Folder layout, failure states, credentials and the CODEX REVIEW REQUIRED — DESIGN ONLY schema proposals are in [docs/GOOGLE_DRIVE_ARCHITECTURE.md](docs/GOOGLE_DRIVE_ARCHITECTURE.md); `npm run drive:plan` prints the proposed folder tree without contacting Google. Automation identity research (separate from human Chair edit access): [docs/GOOGLE_WORKSPACE_ACCESS_MODEL.md](docs/GOOGLE_WORKSPACE_ACCESS_MODEL.md).

Auth UI and credential redemption, hardened replacement-device recovery, deployment/monitoring and school-network rehearsal precede conference use. See the operations runbook and verification report.

References: [Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits), [SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
