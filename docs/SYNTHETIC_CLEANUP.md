# Synthetic-conference cleanup: guarded deletion

**Status: prepared, tested locally, not reviewed, not approved, never run against any hosted project.** This is the "reviewed, guarded cleanup" that lifecycle cutover step 2 ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md)), checklist 1.9.5 and 2.2 ([V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md)) and [LOAD_TEST_EXECUTION_PACKET.md](LOAD_TEST_EXECUTION_PACKET.md) section 10.3 call for. It is the *deletion* that follows the revoke-only fixture `cleanup.sql`; it does not replace it.

> **Running anything in `scripts/cleanup/` or `scripts/cleanup-synthetic.mts` against the hosted project needs the owner's separate approval.** Preparing and testing it locally did not. No cloud agent runs it: a human operator does, on the verified preproduction target, in the cutover write-pause window. **Deletion is irreversible and there is no rollback** (section 9).

## 1. What it is

| File | Role |
| --- | --- |
| `scripts/cleanup/00-prepare.sql` | Guards, the deletion rules (order, scope), per-table row counts and content fingerprints, Storage keys, Auth candidates and the **confirmation digest**. Writes only to temp tables. |
| `scripts/cleanup/10-dry-run-report.sql` | The dry-run report (one JSON line). |
| `scripts/cleanup/20-execute.sql` | Token check, the deletes in foreign-key-safe order, count assertions, audit JSON. |
| `scripts/cleanup/engine.ts` | Validation, script assembly, `psql` runner, result parsing. |
| `scripts/cleanup-synthetic.mts` | The operator wrapper (`npm run cleanup:synthetic -- ...`). |

It is **not a migration**. It lives outside `supabase/migrations`, so it can never become part of the schema, and the migration ledger is not touched. Each run is one `begin ... commit` (dry run: `... rollback`) in one `psql` session; the SQL parts are concatenated by the wrapper.

## 2. Safety model: what makes it refuse

Every refusal is checked **before** anything is deleted, and the wrapper's refusals happen **before any database connection** (`tests/cleanup-guard-no-network.test.ts` proves zero network attempts and that `psql` is never started).

| Layer | Refuses when | Where |
| --- | --- | --- |
| Explicit ids | No ids; not a UUID; listed twice. There is no pattern, "all" or "everything marked synthetic" selection, ever. | wrapper, engine, SQL |
| Target guard | `NEXT_PUBLIC_SUPABASE_URL` from `.env.local` (the **file** value, exactly as `scripts/remote-context.mts`) fails `checkToolTarget`: production-classified (`EXPECTED_SUPABASE_REF`), the PHESMUN project, a ref not in `STAGING_SUPABASE_REFS` / `DEVELOPMENT_SUPABASE_REFS`, no allow-list, malformed URL, contradictory configuration. | wrapper |
| Database URL | `SUPABASE_DB_URL` missing, not a Supabase Postgres URL, or naming a different ref than the guarded URL. | wrapper |
| Protected | Any listed id equals `NEXT_PUBLIC_CONFERENCE_ID` or an entry of `PROTECTED_CONFERENCE_IDS`; `NEXT_PUBLIC_CONFERENCE_ID` missing/blank/placeholder (**fail closed**: the protected list may never be empty). Checked in the wrapper and again in SQL. One protected id in a list refuses the whole list. | wrapper, SQL |
| Synthetic marker | A listed conference's `name` does not start with an approved prefix (section 3), or `features.real` is true. | SQL |
| Active access | Any non-revoked, non-expired `user_access` grant or `private.access_credentials` credential, or any non-revoked submission/amendment link, for a listed conference. **Revoke first.** | SQL |
| Schema drift | A base table in `public`/`private` has no cleanup rule; a rule names a missing table; a table outside those schemas has a foreign key to `conferences`. | SQL (and a test) |
| Role | The connected role is neither superuser nor `BYPASSRLS` (counts under RLS would silently be zero). | SQL |
| Confirmation token | `--execute` without a 64-hex token, or a token that is not the digest recomputed **now** under locks (section 4). | wrapper, SQL |
| Recorded approvals | `--execute` without `--backup-evidence` and `--owner-approval` (free-text references recorded in the audit file). | wrapper |

A run is a **dry run by default**. A dry run turns its own transaction read only (after its temp tables exist) and always ends in `rollback`; a test appends a `delete` to the script and proves it is rejected.

## 3. The synthetic rule, and why

A conference may be deleted only if **all** hold: it is named explicitly; its `name` starts (case-sensitively) with one of **`LOAD TEST · `** (the load fixture's own label), **`DCMUN Development Test`** (the labelled temporary/test conferences in [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)) or **`SYNTHETIC · `**; `features.real` is not true; it is not protected; it has no active access.

Why a name prefix and not a new column: the tool must not need a migration, and the existing synthetic conferences already carry these labels. Why it is safe enough: the prefix is only a *necessary* condition. The sufficient conditions are the operator naming the id, the protected list, the revoked-access check and the token over the exact counts and names, so a real conference named like a test one is still refused by the protected list or the flag, and a typo cannot widen the set. The prefix list is code, not a flag: widening it is a reviewed change.

**Owner action recommended before the real conference is created:** set `features = features || '{"real": true}'` on it, and put its id in `NEXT_PUBLIC_CONFERENCE_ID` or `PROTECTED_CONFERENCE_IDS`. Either alone refuses it; both is belt and braces.

**The original development test conference has the same display name as the temporary one** (`DCMUN Development Test`) and is the conference the deployment is configured for (`NEXT_PUBLIC_CONFERENCE_ID`), so the tool protects it by design. Removing it at step 2.2 is an owner decision (section 12): the operator must *deliberately* change that configuration for the run, which is itself the recorded act of lifting protection; there is no override flag. Identify conferences **by id**, never by name (section 6).

## 4. The confirmation token

The dry run prints a token: SHA-256 over `munos-synthetic-cleanup-v1`, the **project ref**, the sorted **id list**, each present conference's id/name/venue, the ids that were absent, and for every cleanup step its **row count and a content fingerprint** (md5 over the md5 of each affected row), plus the Storage keys and Auth-candidate lists. Execute recomputes all of that inside its own transaction, **after locking every cleanup table** (`SHARE ROW EXCLUSIVE`, `lock_timeout 5s`), and refuses unless it equals the token. So the delete cannot run on a different project, different ids, a different conference name, or data that changed (added, edited or removed row) since the reviewed dry run. Proven in `tests/synthetic-cleanup-db.test.ts`.

## 5. What it deletes and what it keeps

| Object | Decision | Notes |
| --- | --- | --- |
| Rows of the listed conferences in every `public` and `private` table (43 steps; tables below) | **Delete** | Children before parents; one transaction. |
| `public.conferences` rows of the listed ids | **Delete** (last) | |
| `private.access_grant_sources`, `private.amendment_submissions` | **Delete** | No `conference_id`; scoped through their grant/credential/link/amendment. |
| `public.committees.currentSessionId` | **Set to null** (step 25) | Breaks the committees/sessions foreign-key cycle; the committee rows are deleted at step 42. |
| `public.photo_list_epochs` | **Delete**, count not exact | Deleting `committee_staff`/`conference_staff` fires a trigger that can write epoch rows for the same conference; asserted `deleted >= counted` and `remaining = 0`. The only non-exact step. |
| Every other conference (the real one, the seed, unlisted synthetic ones) | **Keep, byte for byte** | Tested by content hashes on PGlite and PostgreSQL 17. The report lists every conference that stays. |
| Migration history (`supabase_migrations`), schema, functions, policies, grants, roles, extensions, project configuration, Vercel | **Keep** | Never touched. |
| Supabase Storage objects | **Keep here; listed for a separate human step** | Section 7. SQL never deletes Storage. |
| `auth.users` (anonymous test users, hash-bootstrapped Executive) and refresh sessions | **Keep here; listed for a separate human step** | Candidates = users referenced *only* by the listed conferences (foreign keys to `auth.users`, plus redemption attempts). A user also referenced by any other conference is excluded and counted. |
| Google Docs/Drive documents behind `resolution_links` / `resolution_submissions` | **Keep (outside the database)** | Their ids disappear with the rows; deleting the files is a separate human action if wanted. |
| Local `.test-sessions/` files | **Keep** | Evidence; deleted at the load packet's final retirement (10.2) after copying. |

Tables, in deletion order: `private.access_grant_sources`, `private.amendment_submissions`, `private.resolution_submissions`, `private.mutation_receipts`, `private.access_redemption_attempts`, `participation_corrections`, `photo_acknowledgements`, `document_decisions`, `document_comments`, `document_versions`, `resolution_links`, `poi_queue`, `participation_events`, `votes`, `speeches`, `amendments`, `participation_adjustments`, `attendance`, `speaker_queue`, `timers`, `debate_states`, `award_scores`, `award_criteria`, `documents`, *(pre-step)*, `sessions`, `conference_session_slots`, `scoring_definitions`, `submission_links`, `amendment_links`, `private.access_credentials`, `user_access`, `committee_staff`, `conference_staff`, `photo_list_epochs`, `photo_slots`, `staff`, `delegates`, `schools`, `audit_log`, `operational_changes`, `committees`, `conferences`. The authoritative list is the rule table in `00-prepare.sql`.

**A new table breaks the run on purpose.** A table with a `conference_id` (or any table in `public`/`private`) and no rule makes the SQL refuse, and `tests/synthetic-cleanup-schema.test.ts` fails in CI: it derives the table list from the live schema (all migrations replayed), requires a rule for each, requires `conference_id`-scoped rules for scoped tables, and checks against the real foreign keys that every child is deleted before its parent. Add the rule in the same reviewed change as the migration.

## 6. Known temporary conferences to clean later

Named generically; **ids are supplied by the operator** and are not in this repository. Expected set, from [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) 1.9.5 and [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md):

1. The **21 Oct temporary isolated conference** in the single hosted project: its TEST committee `TST`, smoke-test replay schools, test delegates, submission link, resolution `TST / 01`, hash-bootstrapped Executive, 4 credentials and 36 device grants (already revoked, not removed), its Storage objects and anonymous Auth users.
2. The **original development test conference** (see section 3: protected by design; an owner decision).
3. Each **`LOAD TEST ·` fixture conference** (fixtures A and B and any approved rerun), after its per-fixture revoke-only `cleanup.sql` shows 0 active.
4. Any other labelled temporary conference the discovery query shows.

**Discovery (read-only, by a human, in the SQL editor or `psql`):** `select id, name, venue, features, created_at from public.conferences order by created_at;` Match by **id and by created_at/venue**, because two conferences share a name. Write the ids into the evidence folder before the dry run.

## 7. Procedure (human operator; owner approval first)

**Prerequisites.** Each is evidence in the folder; none is waived by this tool.

1. Owner's written approval for *this* run (the ids, the date) and for hosted contact. Codex review of this directory is complete. (Section 12.)
2. The last synthetic test is finished and its evidence saved (load packet 10.1 row 6); lifecycle cutover step 1 is done (candidate frozen, synthetic outboxes reconciled; a device that still holds an outbox for a deleted conference will be refused afterwards).
3. Revoke-only `cleanup.sql` applied for every fixture and the verify query shows 0; the 21 Oct temporary conference's grants/credentials are revoked (the tool refuses otherwise).
4. **Backup/PITR state recorded** (section 9): plan, PITR enabled or not, latest backup time, and the decision to proceed without a restore path if there is none. Reference goes in `--backup-evidence`.
5. Write-pause window; no real conference data has been entered (the report's "conferences that stay" lists exactly what remains).
6. `.env.local` on the operator's machine has the allow-listed project's `NEXT_PUBLIC_SUPABASE_URL`, `STAGING_SUPABASE_REFS` (or `DEVELOPMENT_SUPABASE_REFS`), `NEXT_PUBLIC_CONFERENCE_ID`, `PROTECTED_CONFERENCE_IDS`, and `SUPABASE_DB_URL` (direct `db.<ref>.supabase.co`, or the **session** pooler `postgres.<ref>@...pooler.supabase.com:5432`, as the `postgres` role; kept out of the repository, never printed). `psql` is installed.

**A. Dry run** (changes nothing):

```
npm run cleanup:synthetic -- --conference <id> --conference <id>
```

Review, with a second person: the conferences named (each is a synthetic one you expect), **"conferences that stay"** (the real conference is there and nothing else unexpected), the per-table counts against the expected size of those fixtures (a load fixture is committees x sessions x delegates; an unexpectedly large count is a stop), the Storage key count, the Auth-candidate count. It writes `dry-run.json`, `storage-keys.txt`, `auth-user-candidates.txt` under `.test-sessions/cleanup/<time>-<ref>/` (mode 0600, git-ignored) and prints the **token**.

**B. Execute** (the owner's approval is now in hand):

```
npm run cleanup:synthetic -- --conference <id> --conference <id> --execute --token <64 hex> \
   --backup-evidence "<reference>" --owner-approval "<reference>"
```

One transaction: any refusal, token mismatch, count mismatch, foreign-key error or rows left behind aborts it and nothing is removed. On success it prints per-table `affected (expected N)` and writes `execute-audit.json` with the same lists and the two references. If it fails on `lock_timeout`, something holds a lock: find it, do not retry blindly.

**C. Storage objects (separate, listed, human-confirmed).** SQL never deletes Storage. Take `storage-keys.txt` (database-recorded keys, and any object under the conference prefix in the `resolutions` bucket, including orphans). A human removes exactly those objects with the Supabase Dashboard Storage UI or an operator-credentialed Storage API call, after comparing the list with the audit, and records who and when. A key whose first path segment is not a deleted conference id is a stop.

**D. Auth users (separate, listed, human-confirmed).** `auth-user-candidates.txt` lists users that only the deleted conferences referenced. A human removes them in the Dashboard (Authentication) or with the Auth admin API, and removes their refresh sessions. Skip any id the human cannot account for; the list is advisory (a user could be referenced by something outside these tables).

**E. Verify.** Run the dry run for the same ids again: expect `nothing_to_delete`, 0 rows, 0 bucket objects and the same "conferences that stay". Record it. (A second `--execute` with that new token is a harmless no-op; the old token is refused as stale.)

## 8. Ordering with the load test and cutover

1. Per fixture, after its last stage: revoke-only `cleanup.sql`, verify 0 (packet 10.1 rows 1 to 4). **No deletion during the test window**; contingency reruns need the fixtures.
2. After the last approved run and its evidence: the packet's **final global retirement** (identity pool, session files, Previews per the owner).
3. Then this deletion (packet 10.1 row 6 / lifecycle cutover **step 2**), before the cloud-agent disconnect (step 3), token wait-out (step 4), secret/Preview retirement (step 5) and **promotion** (step 6). It can still be run against the preproduction ref only: once the project is production-classified (`EXPECTED_SUPABASE_REF`), the wrapper refuses every run, by design. Revoke-only cleanup does not satisfy step 2.
4. Planned slot: the release plan's cutover day (Mon 2 Nov), as a dependency of cutover, not an extra.

## 9. Rollback: there is none

Deletion is irreversible. There is no undo, no soft delete and no trash. What exists instead:

* **Prevention**: dry run, token, counts asserted equal to the dry run, one transaction, protected list, active-access refusal, owner approval, second-person review.
* **Backup/PITR state recorded first.** Restoring is a whole-project operation that also discards everything written after the restore point; it cannot restore selected rows. The Supabase plan and PITR/backups state must be confirmed and recorded **before** the run; if there is no recoverable state, that fact is recorded and accepted by the owner. No hosted restore project is created without the owner's approval (AGENTS.md).
* **Failure inside the transaction** (the only failure the tool can cause) leaves the database exactly as it was. Storage and Auth deletions (steps C, D) are separate and are *not* transactional; do them only from the listed keys and ids.
* The synthetic data is, by definition, reproducible from the fixtures; real data must not be in scope, which is what the protected list and the "conferences that stay" review exist to prove.

## 10. Evidence to capture (no secrets)

Per run, in the evidence folder (and copied to the release evidence): the ids and how they were identified (discovery output); the backup/PITR record; the owner approval reference; `dry-run.json` and the second reviewer's sign-off; `execute-audit.json`; `storage-keys.txt` with the human deletion record; `auth-user-candidates.txt` with the human deletion record; the verification dry run (`nothing_to_delete`); the commit SHA of this directory. The JSON holds counts, fingerprints, conference names/ids, Storage paths and Auth user ids only. No database URL, password, key, access code or token-of-access appears; the confirmation token is not a credential. Do not paste secrets into `--backup-evidence` or `--owner-approval`.

## 11. Tests (what is proven, on what)

Local only; nothing contacts a hosted project. `npm test` runs all of them; the PostgreSQL 17 cases need `TEST_POSTGRES_URL` (an embedded PostgreSQL 17.5 on a loopback port, run as a non-root user, stopped afterwards; the helper refuses non-loopback hosts) and are skipped otherwise.

* `tests/synthetic-cleanup-db.test.ts` (PGlite **and** PostgreSQL 17): dry-run counts equal an independent catalogue-derived count for a synthetic conference with **every table populated**; Storage keys and Auth candidates; the dry run is read only and changes nothing; every refusal (empty list, protected, not synthetic by name/case/position, flagged real, each of four kinds of active access, malformed/duplicate ids, empty protected list, bad mode/label, non-bypass role); token mismatch cases (wrong, malformed, other ids, other project, extra id, data changed after the dry run, renamed conference); execute removes exactly the named conference and leaves the real conference, the seed and an unlisted synthetic conference **row-hash identical** (and `auth.users`, `storage.objects` untouched); idempotent re-run; a count mismatch (a trigger makes a later step find fewer rows) and a foreign-key violation (another conference's row referencing a listed document) both roll the whole transaction back; schema drift refusals.
* `tests/synthetic-cleanup-schema.test.ts`: derived from the live schema; a new table without a rule fails; foreign-key order is checked against every real foreign key.
* `tests/cleanup-guard-no-network.test.ts`: the real wrapper in a throwaway directory with network and DNS blocked and `psql` replaced by a stub: 37 refusal cases each with its specific reason, zero network attempts, the stub never started, no secret in output, no evidence written; positive controls reach the stub, write 0600 evidence and print the token.
* `tests/synthetic-cleanup-wrapper-db.test.ts` (PostgreSQL 17): the real wrapper and real `psql`, dry run, token, refusals, execute, audit evidence, idempotent re-run (`--local-url` accepts only loopback and a database named `munos_test_*`/`munos_local_*`).

**Not covered** (and why): any hosted behaviour (this is the point of the owner's separate approval); the real `postgres` role's exact attributes and Supabase-specific objects (the dry run refuses if the role cannot bypass RLS; verify on first dry run); real Storage and Auth-admin deletion (manual by design); concurrent application writers beyond the table locks (the project is write-paused; the locks make recount-and-delete atomic and a stray writer fails the count assertion); a conference whose rows reference other conferences' rows through a single-column foreign key (fails safely, proven); the claim that "no real data exists" (the tool shows what stays; a human confirms).

## 12. Owner decisions needed

1. Approve hosted contact for this tool (and the date/window), and who the human operator and the second reviewer are.
2. The **original development test conference**: delete at step 2.2 (then reconfigure `NEXT_PUBLIC_CONFERENCE_ID` for the run) or keep until production promotion and remove by another route.
3. Mark the real conference: set `features.real = true` and register its id as protected at creation.
4. Backup/PITR: which state must exist before running; accept in writing if none.
5. Whether Storage objects and Auth users are removed in the same window (steps C, D) and who does it.
6. Accept or change the approved name prefixes (`LOAD TEST · `, `DCMUN Development Test`, `SYNTHETIC · `).
7. Whether to delete the Google Drive files behind `TEST` resolutions.

## 13. Independent-review notes (Codex)

Please look hardest at:

1. **Token and TOCTOU.** `00-prepare.sql` section 11 (canonical text) and the order "validate, lock (execute only), count, digest" then `20-execute.sql`. Is anything that influences the deletes missing from the digest? Is `SHARE ROW EXCLUSIVE` on all 42 cleanup tables enough against concurrent writers, and is `lock_timeout 5s` the right failure mode?
2. **Scope correctness.** Each rule's `scope` (a static string, never operator input), especially the two tables without `conference_id`, and whether any table can hold target rows reachable only through a single-column foreign key (the foreign-key test shows a violation fails closed, but check for silent *under*-deletion that a later foreign key would not catch).
3. **Dynamic SQL.** `format('%s ...')` interpolates only the rule table's own constants and catalogue-derived identifiers (`%I`). Operator input reaches SQL only through `set_config(...)` strings, validated by the wrapper's regexes and again by the SQL (`^[0-9a-f]{8}-...$`, label pattern). Confirm there is no path from a free-text flag (`--backup-evidence`, `--owner-approval`) into SQL: there should be none; they are only written to the audit file.
4. **Synthetic rule.** Name-prefix as a necessary condition only; `features.real`; the protected list as a hard fail-closed input. Are the prefixes right, and is `DCMUN Development Test` too broad given the original shares it?
5. **Target guard use.** The wrapper passes the *file* URL to `checkToolTarget` and merges `process.env` over the file for configuration, exactly as `remote-context.mts`. Check the ref cross-check for `SUPABASE_DB_URL` (direct and pooler forms) and that `--local-url` (tests) cannot be used against a tunnelled hosted database (loopback and a `munos_test_*`/`munos_local_*` database name only).
6. **Triggers.** Delete-time trigger effects: only `photo_epoch_trigger` fires on delete (steps 33 and 34). The non-exact step 35 is the one deviation from exact counts; is that acceptable?
7. **Schema-drift guard** covers tables and foreign keys to `conferences`, not new *columns* or non-key references to a conference; a new foreign key from a ruled table to another ruled table is caught by the foreign-key-order test.
8. **Auth candidates** are advisory; the SQL cannot see references from outside `public`/`private`. The manual step must treat them so.
9. **PGlite quirk (test infrastructure only).** PGlite's `exec` returns silently, without throwing, when a `BEFORE DELETE` row trigger deletes a sibling row of the same statement (PostgreSQL raises error 27000). The count-mismatch test therefore uses an `AFTER` statement trigger that removes a row for the *next* step. `PsqlRunner` (used on hosted and PostgreSQL 17) throws on any non-zero exit.
10. **What was not exercised**: anything hosted; `rolbypassrls` of the hosted `postgres` role is assumed true and is checked at run time.
