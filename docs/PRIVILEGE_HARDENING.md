# Privilege hardening (HD1 + narrow HD2): migration `20261022090000_privilege_hardening`

**Prepared, not applied.** This document describes a PROTECTED schema change ([AGENTS.md](../AGENTS.md) protected areas 3 and 4). Nothing here was run against a hosted project, no Supabase or Vercel call was made to write it, and no version, tag or PR was created. **Applying it needs the owner's separate approval and a Codex review of the exact commit.** The owner approved HD1 and a narrow HD2 in principle (release strategy: keep direct Supabase RPCs for DCMUN XVIII; the gateway/attestation work is deferred) because the hosted audit confirmed excess privileges ([HOSTED_PRIVILEGE_AUDIT_2026-10-22.md](HOSTED_PRIVILEGE_AUDIT_2026-10-22.md)). Context: [CONFERENCE_RELEASE_PLAN.md](CONFERENCE_RELEASE_PLAN.md) section 4.

## What it does

File: [`supabase/migrations/20261022090000_privilege_hardening.sql`](../supabase/migrations/20261022090000_privilege_hardening.sql). Grants and default privileges only. No table, column, function body, policy, RLS or data change. Idempotent.

| Part | Statement | Purpose |
| --- | --- | --- |
| HD1 | `alter default privileges for role postgres revoke execute on functions from public` (global) | A function created later is not executable by PUBLIC. |
| HD1 | `... in schema public` and `... in schema private` `revoke execute on functions from anon, authenticated, service_role` | Same for the three API roles. A `DROP FUNCTION` + `CREATE`, a new overload or a new function is no longer silently exposed (assumption A13). |
| HD2 (narrow) | `revoke truncate, references, trigger on all tables in schema public from anon, authenticated, service_role`, plus `maintain` on PostgreSQL 17+ (dynamic SQL, guarded on `server_version_num >= 170000`) | Removes the excess privileges the audit found on `service_role`. |
| HD2 | `alter default privileges for role postgres in schema public revoke truncate, references, trigger [, maintain] on tables from ...` | A table created by a later migration does not regain them. |
| HD2 | `revoke all on all sequences in schema public from ...` and the matching default | Sequences: a no-op today (the audit shows none), keeps new sequences closed. |
| Check | A final `do` block raises if any of the three roles still holds a removed privilege on any `public` relation | The migration is one transaction, so it aborts instead of leaving a half-hardened state. The case it guards on hosted: the hosted `postgres` role is not a superuser, so a `REVOKE` only removes privileges it (or the owner) granted. |

Deliberately **unchanged**: `authenticated` SELECT on every `public` table, every function EXECUTE grant, the `service_role` submission path (`submit_resolution`, `submit_amendment`, `submission_link_info`, `amendment_link_info`), schema USAGE, RLS and policies.

Not touched: **`supabase_admin`-owned default privileges** (not alterable by `postgres` on hosted; they only affect objects `supabase_admin` creates, and no migration creates any). The inventory model leaves them out.

### Honest limits

- PostgREST does not expose TRUNCATE, REFERENCES, TRIGGER or MAINTAIN. This is **defense in depth**, not the fix for a reachable bypass.
- The gateway-less residual risk stays: a holder of a valid production staff token or of the secret key can still call the RPCs they are allowed to call, from any client. Nothing here binds writes to the Production deployment ([CONFERENCE_RELEASE_PLAN.md](CONFERENCE_RELEASE_PLAN.md) section 2).
- `service_role` still bypasses RLS and can execute the two submission RPCs.
- The global default revoke applies to **every** function later created by `postgres` in any schema, including functions created by an extension script run as `postgres`. No committed migration creates an extension.

## Convention for later migrations

New functions are executable by their owner only. **A later migration that adds an RPC must `GRANT EXECUTE` explicitly** to the role that should call it (`authenticated` for staff RPCs, `service_role` for server-route RPCs); until then the function is unreachable. The existing migrations already follow this (`revoke all ... from public, anon` then `grant execute ... to ...`), so nothing existing needs a new grant. New tables get no `anon`/`authenticated`/`service_role` privileges from defaults, so a table that needs `authenticated` SELECT must also `GRANT SELECT` explicitly, as every existing table migration does.

## Expected hosted before/after diff

Derived from the audit; **Proposed** until the hosted dry run confirms it.

| Object | Before (audit) | After |
| --- | --- | --- |
| `service_role` table privileges on the 36 `public` tables | TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on each (144 privilege grants); also on `public.participation_history` if the view carries them (the audit counted tables) | none |
| `anon`, `authenticated` table privileges | anon none; authenticated SELECT only | unchanged |
| Function EXECUTE for `anon`, `authenticated`, `service_role`, PUBLIC (all functions in `public` and `private`) | as in the audit table | unchanged |
| Sequence privileges for the three roles | none | none |
| `pg_default_acl` role `postgres`, schema `public`, tables | `{postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}` | `{postgres=arwdDxtm}` |
| `pg_default_acl` role `postgres`, schema `public`, sequences | `{postgres=rwU}` | unchanged |
| `pg_default_acl` role `postgres`, schema `public`, functions | `{postgres=X}` | unchanged |
| `pg_default_acl` role `postgres`, global, functions | not read by the audit; absent means PostgreSQL's default (PUBLIC may EXECUTE new functions) | row `{postgres=X}` (PUBLIC removed) |
| `pg_default_acl` schema `private` | no row | no row (revoking absent entries creates none) |
| `supabase_admin` default ACLs | arwdDxtm / rwU / X to the API roles in `public` | unchanged (cannot be altered by `postgres`) |
| Application behaviour | none of the above is reachable through PostgREST | no change; the 56 functions, RLS, policies and data are untouched |

The same diff was produced locally on PostgreSQL 17.5 with the hosted-calibrated model: 4 matrix rows removed (`service_role` MAINTAIN, REFERENCES, TRIGGER, TRUNCATE; 37 relations each, 36 tables plus the view), and `pg_default_acl` changed exactly as above.

## Local verification (done)

- [`tests/privilege-hardening-db.test.ts`](../tests/privilege-hardening-db.test.ts), on PGlite and, with `TEST_POSTGRES_URL`, on PostgreSQL 17: the model reproduces the audit before the migration (exact EXECUTE lists, authenticated SELECT only on the 36 tables, `service_role` with the four privileges and no DML); after it, the function EXECUTE matrix is identical for anon, authenticated, service_role and PUBLIC, authenticated and anon table privileges are identical, `service_role` holds nothing on any table (TRUNCATE and SELECT are refused with 42501, `submit_resolution` behaves the same), default ACLs are as in the table above; a function created, replaced, dropped and recreated, overloaded, or created in `private` is executable by nobody until granted, an explicit grant works, and a new table or sequence gives the three roles nothing; the migration is idempotent; the prepared revert returns every ACL and default ACL to the pre-hardening state. Control assertions prove that, before the migration, the same new function and table **were** exposed (so the checks are not vacuous). A mutation (deleting the global PUBLIC revoke) makes the tests fail.
- The aborted-transaction dry run below, replayed locally in the same single-statement shape; the final check block also fires when run against the pre-hardening state.
- Regenerated [`docs/generated/isolation-t1-inventory*`](generated/isolation-t1-inventory.md) from the corrected model (`TEST_POSTGRES_URL=... npx tsx scripts/isolation-inventory/inventory.mts`, then `--check`).

## Hosted verification procedure (for later; needs approvals first)

Prerequisites: owner approval recorded with the exact commit; Codex review of that commit; the lifecycle phase still allows scoped agent test access ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md)); a quiet window; the revert file below prepared. Use the existing preproduction project only; do not create another ([AGENTS.md](../AGENTS.md) protected area 1).

1. **Read-only "before" capture.** Run the queries in [HOSTED_PRIVILEGE_AUDIT_2026-10-22.md](HOSTED_PRIVILEGE_AUDIT_2026-10-22.md), and additionally `select rolname, rolsuper, rolcreaterole from pg_roles where rolname in ('postgres','supabase_admin')` and the `pg_default_acl` query (look for a row with `defaclnamespace = 0`). Save the output. Ledger: `select count(*), min(version), max(version) from supabase_migrations.schema_migrations`; the target version `20261022090000` must not exist yet.
2. **Aborted-transaction dry run.** One `execute_sql` call whose text is the migration file followed by a check block ending in `RAISE EXCEPTION`, exactly as for the earlier migrations. The single statement string runs as one implicit transaction, so everything is rolled back; the error message is the evidence. Check block (append after the migration text):

   ```sql
   do $dry$
   declare leftover int; auth_sel int; other_acl int; svc text; pub int; defs text;
   begin
     select count(*) into leftover from pg_class c join pg_namespace s on s.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
       where s.nspname = 'public' and r.rolname in ('anon','authenticated','service_role')
         and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN');
     select count(*) into auth_sel from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind in ('r','p') and has_table_privilege('authenticated', c.oid, 'SELECT');
     select count(*) into other_acl from pg_class c join pg_namespace s on s.oid = c.relnamespace
       cross join lateral aclexplode(c.relacl) a join pg_roles r on r.oid = a.grantee
       where s.nspname = 'public' and r.rolname in ('anon','authenticated','service_role')
         and not (r.rolname = 'authenticated' and a.privilege_type = 'SELECT');
     select string_agg(p.proname, ',' order by p.proname) into svc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','private') and has_function_privilege('service_role', p.oid, 'EXECUTE');
     select count(*) into pub from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public','private')
         and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0);
     select string_agg(coalesce(n.nspname,'(global)') || '/' || d.defaclobjtype::text || '=' || d.defaclacl::text, ' ; ')
       into defs from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace;
     raise exception 'DRYRUN_OK leftover_four=% authenticated_select=% other_table_acl_entries=% service_exec=[%] public_exec_fns=% defaults=[%]',
       leftover, auth_sel, other_acl, svc, pub, defs;
   end $dry$;
   ```

   Expected message locally and, if the audit is right, on hosted: `leftover_four=0 authenticated_select=36 other_table_acl_entries=0 service_exec=[amendment_link_info,submission_link_info,submit_amendment,submit_resolution] public_exec_fns=0` and defaults `(global)/f={postgres=X/postgres} ; public/f={postgres=X/postgres} ; public/S={postgres=rwU/postgres} ; public/r={postgres=arwdDxtm/postgres}` (a hosted `supabase_admin` row, if present, will also be listed). **Stop conditions:** `privilege hardening incomplete: ...` (a privilege could not be revoked, for example granted by another role), `permission denied`/`must be owner` on `alter default privileges` (hosted `postgres` cannot alter its own defaults the way assumed; do not improvise), or any number that differs from the audit. Then re-run step 1's queries: the "before" output must be unchanged (the dry run left nothing).
3. **Apply once.** Only after steps 1 and 2 pass and the owner confirms: the Supabase connector's `apply_migration` with `name` = `privilege_hardening` and `query` = the file text byte for byte (one call; do not split or edit), or `supabase db push` by the owner. If the connector is used, its ledger version is the apply-time timestamp.
4. **Ledger version fix.** Confirm no row has `20261022090000`, read the connector's version, then `update supabase_migrations.schema_migrations set version = '20261022090000' where version = '<connector version>' and name = 'privilege_hardening'` (exactly one row), as was done on 21 October. Re-run the ledger comparison (versions and names equal the filenames).
5. **"After" capture.** Repeat step 1's queries and compare with the diff table above. Then smoke-check that the application still works end to end on staging (a staff read, a mutation, a public submission through the server route) with synthetic data only.
6. **Record** in the release evidence: commit SHA, reviewer, the before/after outputs, the dry-run message, the ledger result.

## Forward-only revert

Migrations are forward-only; an applied migration is never edited. The inverse is prepared and kept **unapplied** at [`supabase/prepared-reverts/20261022090000_privilege_hardening_revert.sql`](../supabase/prepared-reverts/20261022090000_privilege_hardening_revert.sql) (outside `supabase/migrations`, so no replay or `db push` picks it up). If the owner decides to undo the hardening, copy it into `supabase/migrations` under a **new, later timestamp**, review it, replay from empty, and apply it through the same human-controlled release. It restores the audited pre-hardening state (the four privileges for `service_role` on existing tables; the table defaults for the three roles; PostgreSQL's default PUBLIC EXECUTE on new functions) and re-opens the exposure. [`tests/privilege-hardening-db.test.ts`](../tests/privilege-hardening-db.test.ts) replays it after the hardening and asserts the ACLs equal the pre-hardening snapshot.

## Risks

| Risk | Mitigation |
| --- | --- |
| Hosted `postgres` is not a superuser; `alter default privileges for role postgres` or the revokes may be refused or partially effective | The aborted dry run on hosted answers this before anything is applied; the in-migration check aborts if any removed privilege remains. |
| A hosted global default row, or grants made by another role, differ from the audit | Step 1 reads `pg_default_acl` including the global row; the check block lists everything; stop conditions above. |
| Tooling or fixtures that used `service_role` for TRUNCATE (for example resetting a staging database with the secret key) stops working | No script under `scripts/`, `lib/` or `app/` was found that truncates through the secret key (text search; `tests/` use local databases as the owner); external tooling was not inspected. Re-run the repository's remote scripts against staging after applying. |
| A later migration adds an RPC and forgets the grant | It is unreachable and its test fails; the convention above and the inventory `--check` make the omission visible. This fails closed. |
| The global function default also affects extension scripts run as `postgres` | None committed; documented in the migration header. |
| Gives a false sense of completeness | It is defense in depth. The gateway-less residual risk, the RLS-bypassing secret key and the directly callable RPCs are unchanged and listed in [CONFERENCE_RELEASE_PLAN.md](CONFERENCE_RELEASE_PLAN.md) section 2. |
| Audit not covering exposed schemas, Storage/auth, supabase_admin objects, pg_cron | Listed as Untested in the audit; repeat the audit after promotion. |

## Owner decisions still open

1. Approval to apply (separate from this approval in principle), the window, and who applies it.
2. Whether to keep the global (all-schema) function default revoke, or restrict it to `public` and `private` only (then a function created by `postgres` in another schema would again be PUBLIC-executable by default; none exist today).
3. Whether the repository's inventory check (`--check`) should be wired into CI (HD4).
