# Sequential Chair numbering: hosted verification procedure (migration 27)

Prepared 21 October 2026 on `origin/main` `276074a`. **This is an operator procedure for review. It authorises nothing and nothing in it has been run against a hosted project.** No Supabase or Vercel call was made to write it, no migration was applied, and no secret, access code or key appears in it. It does not change `package.json`, create a tag, or alter any applied migration.

It describes how to verify [`supabase/migrations/20261021140000_sequential_chair_numbering.sql`](../supabase/migrations/20261021140000_sequential_chair_numbering.sql) (PR #59) on the **existing** preproduction project (`kllhswucdhqqywnzxado`, dashboard name "DCMUN Staging"; see [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)). It does not create another hosted database ([AGENTS.md](../AGENTS.md) protected area 1; [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md)). The rollout it follows is the one recorded for migrations 22 to 26 in [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md#migrations-22-to-26-21-october-2026-owner-approved): ledger reconciliation, an aborted-transaction dry run, one `apply_migration` call, ledger version set to the filename version, MD5 comparison of the stored statements, grant checks, then an isolated temporary test conference.

## How every statement is labelled

| Label | Meaning |
| --- | --- |
| **Verified** | Read in the repository at `276074a`, or run in this preparation session. The evidence is named. |
| **Proposed** | A step or query written here that has not been executed anywhere. It must be reviewed before use. |
| **Untested (hosted)** | Behaviour of the hosted Supabase project or its connector that nobody has observed. Do not assume it. |

Local runs in this session used **PGlite 0.5.8, which reports PostgreSQL 18.3**, not PostgreSQL 17. The PostgreSQL 17 concurrency test ([`tests/sequential-chair-numbering-concurrency.test.ts`](../tests/sequential-chair-numbering-concurrency.test.ts)) is skipped without `TEST_POSTGRES_URL` and runs in CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml), PostgreSQL 17); it was **not** run here.

## 0. What the migration does

**Verified** (file read). One new function, two patched functions, nothing else:

| Object | Change |
| --- | --- |
| `private.next_resolution_code(conf uuid, committee uuid)` | **Created.** `SECURITY DEFINER`, `search_path=''`, `revoke all ... from public, anon, authenticated`. Returns `<committee code> / <NN>`: highest sequential suffix in that committee plus one, at least two digits, never truncated (`99` then `100`), range 01 to 999999, then raises `No free resolution number in committee X` (22023). Legacy 8-character hex suffixes never match and are ignored. Takes the committee row lock itself. |
| `private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)` | **Patched** by `pg_get_functiondef` plus one exact anchor: the `newDocument` code expression `c.code\|\|' / '\|\|substr(new_id::text,1,8)` becomes `private.next_resolution_code(conf,cid)`. |
| `public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)` | **Patched** the same way: the `count(*) + 1` and skip loop become `doc_code := private.next_resolution_code(link.conference_id, link.committee_id)`. |

No table, column, constraint, policy or grant is changed and there is **no backfill**: existing rows are never renumbered, and a legacy `TST / ca7640bb` stays valid and unique. Each anchor is replaced only if it occurs exactly once, otherwise the migration raises `<label> changed; review before applying` and nothing is applied. Replay by mutation id or submission id returns before numbering, so a retry consumes no number.

### What was verified locally already

| Evidence | Result | Source |
| --- | --- | --- |
| PGlite replay of all 27 migrations, then 01, 02, 03; retried mutation id adds nothing and burns no number; Chair and public share one sequence; committees independent; legacy hex ignored; upgrade from the previous schema leaves existing rows unchanged; the helper is not callable by an API role | **Verified** (`tests/sequential-chair-numbering-db.test.ts`; passed in this session) | [`tests/sequential-chair-numbering-db.test.ts`](../tests/sequential-chair-numbering-db.test.ts) |
| `/99` then `/100` (not a truncated `/10`) for both paths, dense 01..99, `/99999` then `/100000`, upper bound error at `/999999` with no 7-digit code | **Verified** (passed in this session) | [`tests/sequential-chair-numbering-boundary-db.test.ts`](../tests/sequential-chair-numbering-boundary-db.test.ts) |
| Client mirror of the numbering rule (`nextResolutionCode`), including 100 and the six-digit boundary | **Verified** (passed in this session) | [`tests/resolution-number.test.ts`](../tests/resolution-number.test.ts), [`lib/resolution-number.ts`](../lib/resolution-number.ts) |
| N parallel Chair creates behind one lock give exactly 01..N; mixed unsynchronised Chair and public traffic never collides or skips; Chair-holds-lock vs public and public-holds-lock vs Chair give consecutive numbers; the same mutation id sent concurrently adds one document; committees do not block each other; boundary races at 99 to 100 and 99997 to 100003 | **Verified in CI only** (real PostgreSQL 17 connections; **not run in this session**) | [`tests/sequential-chair-numbering-concurrency.test.ts`](../tests/sequential-chair-numbering-concurrency.test.ts) |
| Target guard, health probe and deployment-binding self-tests | **Verified** (passed in this session; the five test files run in total gave 33 passing tests, 0 failing) | [`tests/target-guard.test.ts`](../tests/target-guard.test.ts), [`tests/rehearsal-delivery-audit.test.ts`](../tests/rehearsal-delivery-audit.test.ts) |
| The dry-run SQL of section 4 (Part 2), run after replaying migrations 1 to 26 and the migration text on PGlite | **Verified locally**: ended with `DRYRUN_OK ... chair=TST / 01,TST / 02,TST / 03; public=TST / 04/replayed; legacy_hex_ignored=ok; boundary=100,101`, and afterwards the helper, the fixture conference and the fixture user did not exist (full rollback). A deliberately wrong expectation produced `DRYRUN_STRUCTURE_OK_FUNCTIONAL_NOT_RUN ... functional_error=DRYRUN_FAIL ...`. | Ad hoc script in the session scratch directory; not committed |
| Grants and flags of the helper after replay: owner `postgres`, `prosecdef` true, `proconfig` `search_path=""`, ACL `{postgres=X/postgres}`, no execute for `anon`, `authenticated`, `service_role` or `public`; function count 55 to 56 (only the helper is new); the patched functions keep their ACLs (`apply_mutation` `{postgres, authenticated}`, `submit_resolution` `{postgres, service_role}`) | **Verified locally** (PGlite) | Ad hoc query; the query is section 3.2 below |
| Inverse patch (section 7): after migration 27, applying the anchor replacement in reverse restores both function definitions to **byte-identical** `pg_get_functiondef` text (equal MD5) to the state after migration 26 | **Verified locally** (PGlite) | Ad hoc script; the SQL is section 7 below |
| Hash-only credential insert (section 8.1): inserting only the SHA-256 digest into `private.access_credentials` and redeeming the formatted raw code through `public.redeem_access_code` returns `status: ok` and creates a committee-scoped grant | **Verified locally** (PGlite) | Ad hoc script |

### What is untested hosted behaviour

Everything below is **Untested (hosted)**: that the hosted `pg_get_functiondef` text matches the repository chain so every anchor matches (the 21 October dry run proved this for migrations 22 to 26 only); that the connector runs the file as one transaction; the dry-run harness against the hosted `auth.users` and role setup; the connector's stored-statement shape for MD5; real PostgREST concurrency; Realtime and the offline outbox with sequential codes; that `/rest/v1/rpc/next_resolution_code` is unreachable; and the public `/submit/<token>` path (needs the server-only key; checklist item 1.5.1 in [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) records it as never run).

## 1. Approvals and preconditions (all required before step 6)

| # | Needs | Why |
| --- | --- | --- |
| A1 | **Owner approval** to apply migration 27 to the preproduction project, recorded next to the run (who, when, exact commit). | [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) owner-approval gates: any migration 27 or later needs owner approval, independent review, replay on preproduction, then apply once. Feature freeze applies. |
| A2 | **Independent (Codex) review** of the migration at the exact commit, recorded. The file's header is addressed to Codex; the repository does not record that review. | [AGENTS.md](../AGENTS.md) protected area 3. |
| A3 | The file on `main` is byte-identical to the reviewed copy. Record its trimmed MD5 (section 3.3). At `276074a` it is `b67f61f8881307e95cd97e32fcf0a6f1` (**Verified**, computed locally). Recompute it at apply time. If the file changes (even a comment), the MD5 and the review change. | Same byte-for-byte rule used on 20 October. |
| A4 | Owner confirms that **scoped cloud-agent test access to this project is still in force** (lifecycle "Development" phase). After promotion no agent may run any of this ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md), "After promotion"). | The project is still in its development role. |
| A5 | A reviewed **revert migration** is prepared on a branch, replayed locally and **not applied** (section 7). | Migrations are forward-only; the revert must not be improvised during an incident. |
| A6 | If the public HTTP path or Chair-vs-public concurrency is to be exercised against hosted: the owner supplies `SUPABASE_SECRET_KEY` in an ignored local environment. It is never pasted into chat, a doc or a ticket. | [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) owner-approval gates. Without it those two checks stay **Untested (hosted)**, covered only by the PostgreSQL 17 CI test. |
| A7 | A quiet window: nobody else is using the temporary or test conferences, and no other migration or deployment is in progress. | Avoids confusing evidence and conflicting locks. |

## 2. Target checks (no writes)

Stop at the first failure. None of these changes anything.

**T1. Allow-list and target guard, offline, nothing contacted. Verified command shape** (the three outcomes below were run in this session with a placeholder ref):

```
STAGING_SUPABASE_REFS=kllhswucdhqqywnzxado npx tsx -e "import {assertToolTarget} from './lib/platform/target-guard'; console.log(assertToolTarget('https://kllhswucdhqqywnzxado.supabase.co'))"
```

Expected: prints the ref. For a ref that is not listed it throws `Target guard refused: ... is not listed in STAGING_SUPABASE_REFS or DEVELOPMENT_SUPABASE_REFS. Nothing was contacted.` For the PHESMUN ref (`gglltljhdpkfjnyjmnif`) it throws `... is the PHESMUN production project ...`. `EXPECTED_SUPABASE_REF` must be **unset** in the shell (a project listed there is refused as production by `checkToolTarget`). Do not list the ref in `STAGING_SUPABASE_REFS` and `DEVELOPMENT_SUPABASE_REFS` at the same time (`targetConfig` throws). Which list holds the ref is an open owner decision ([DATABASE_BACKED_DEPLOYMENT.md](DATABASE_BACKED_DEPLOYMENT.md#3-target-guard-registration-open-owner-decision)); scripts in this procedure work with either, except the hosted rehearsal helper, which requires `STAGING_SUPABASE_REFS`.

**T2. Project identity. Proposed.** Using the Supabase connector's read-only calls (`list_projects`, `get_project`, `get_project_url`) or the dashboard, record: ref equals `kllhswucdhqqywnzxado`; URL equals `https://kllhswucdhqqywnzxado.supabase.co`; region `ap-south-1`; Postgres 17.x; status `ACTIVE_HEALTHY`; exactly one project visible. **Stop** if the ref differs, the PHESMUN ref appears in the connection, or a second project is visible and was not expected. The connector's organisation-wide reach means the ref in every call is the safeguard: every SQL call below begins by reading `current_database()` and the first call is compared with T2.

**T3. Preproduction, synthetic data only. Proposed** (read-only SQL; expected result **zero rows** for each of the first four):

```sql
select id, name, venue from public.conferences where name !~* '(test|temporary)' and venue !~* '(test|temporary)';
select id, email from public.delegates where email !~* '@example\.com$';
select id, name from public.staff where name !~* '(test|temporary)';
select count(*) as non_anonymous_users from auth.users where coalesce(is_anonymous,false) = false;
select (select count(*) from public.conferences) as conferences, (select count(*) from public.committees) as committees,
       (select count(*) from public.documents) as documents, (select count(*) from public.user_access where revoked_at is null) as active_grants;
```

Expected from the record: only conferences labelled test or temporary (the original `DCMUN Development Test`, the 21 October temporary conference, and `TEST Offline Rehearsal (temporary)`), no non-anonymous auth users, and counts roughly consistent with [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (**Untested (hosted)** since 21 October). Any real-looking name, a non-`example.com` delegate email, or a non-anonymous auth user is a **stop**: real data may have entered and nothing here may run.

**T4. Ledger length and ordering. Proposed.** Expected **26 rows** (not 27: the migration is not applied yet):

```sql
select count(*) as rows, min(version) as first, max(version) as last from supabase_migrations.schema_migrations;
```

Expected `rows = 26`, `first = 20261005103403`, `last = 20261021130000`. A row with version `20261021140000`, or any row after `20261021130000`, is a **stop**: the migration may already be applied (see section 5, step 5.3 for how to confirm), and `create function private.next_resolution_code` would fail.

**T5. Migration not partially present. Proposed:**

```sql
select to_regprocedure('private.next_resolution_code(uuid,uuid)') as helper;   -- expected NULL
```

## 3. Ledger reconciliation and pre-apply capture (no writes)

### 3.1 Versions and names equal the filenames

**Verified** (generator run locally; it prints 26 rows for the 26 files other than migration 27). Generate the expected list from the repository:

```
for f in $(ls supabase/migrations | sort | grep -v '^20261021140000'); do v=${f%%_*}; n=${f#*_}; n=${n%.sql}; printf "('%s','%s'),\n" "$v" "$n"; done
```

Paste the 26 lines into the `values` list below (drop the final comma). **Proposed** query; expected result **zero rows**:

```sql
with expected(version, name) as (values
  -- paste the 26 generated lines here
  ('20261005103403','conference_foundation')
), actual as (select version, name from supabase_migrations.schema_migrations)
select 'missing_in_ledger' as problem, e.version, e.name from expected e left join actual a using (version, name) where a.version is null
union all
select 'unexpected_in_ledger', a.version, a.name from actual a left join expected e using (version, name) where e.version is null;
```

Any row is a stop. A version equal to the connector's apply-time timestamp instead of the filename version is the exact problem the 21 October apply had to fix by hand; the five rows for migrations 22 to 26 are the ones to look at.

### 3.2 Function inventory and the two functions to be patched (rollback evidence)

**Proposed.** Run once before the dry run and save the output outside the repository (function bodies and grants only: no secrets, no data). After the apply, run it again and diff.

```sql
-- C1. Definitions of the two functions that will be patched
select p.oid::regprocedure::text as signature, md5(pg_get_functiondef(p.oid)) as def_md5, length(pg_get_functiondef(p.oid)) as def_chars
from pg_proc p
where p.oid in ('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure,
                'public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)'::regprocedure)
order by 1;
-- C1b. The full text of each (run each separately and save it; this is the rollback source of truth, see section 7)
select pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
select pg_get_functiondef('public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)'::regprocedure);

-- C2. Owner, security definer, search_path and client execute grants of every function in public and private
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.proconfig as config, p.proacl::text as acl,
       coalesce((select string_agg(r.rolname, ',' order by r.rolname) from pg_roles r
                 where r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid, p.oid, 'execute')), '') as client_roles,
       has_function_privilege('public', p.oid, 'execute') as public_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') order by 1, 2, 3;
```

Hosted `pg_get_functiondef` text is **not** expected to equal a local PGlite or PostgreSQL 17 replay byte for byte, so the hosted MD5 is compared with the **hosted** dry run and the **hosted** result after the apply, never with a local number. The local counts for orientation only: 55 functions in `public` and `private` after migrations 1 to 26, 56 after 27 (**Verified locally**, PGlite). The hosted project also holds platform functions the repository does not create (for example `public.rls_auto_enable()`), so compare hosted before and after, not hosted and local.

### 3.3 MD5 of the stored statements, the technique used on 20 and 21 October

**Proposed** shape, because the exact stored form is **Untested (hosted)**. The connector's `apply_migration` stored the file text as the ledger's `statements`, and the 21 October check compared `md5` of the trimmed text with the trimmed file for migrations 22 to 26. Migrations 1 to 21 were applied by the CLI, which may store the file as several statements, so an MD5 comparison for those is not expected to work; they were verified by the schema fingerprint recorded in [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md#verification-against-the-live-project) instead.

Local side (**Verified**: prints the value in A3 for this commit):

```
node -e "const c=require('crypto'),fs=require('fs');console.log(c.createHash('md5').update(fs.readFileSync(process.argv[1],'utf8').trim()).digest('hex'))" supabase/migrations/<file>.sql
```

Hosted side, to run **after** the apply and for the five earlier connector rows if their shape matches (first check the shape):

```sql
select version, name, array_length(statements, 1) as parts, md5(btrim(array_to_string(statements, E'\n'))) as md5_trimmed
from supabase_migrations.schema_migrations where version in ('20261021090000','20261021100000','20261021110000','20261021120000','20261021130000','20261021140000') order by version;
```

If `parts` is 1, `md5_trimmed` must equal the local value for that file. If `parts` is greater than 1, record that the shape differs and rely on the function-level checks of section 6.

## 4. Aborted-transaction dry run

**Purpose.** Prove on the live preproduction database, with nothing left behind, that every anchor matches the hosted function bodies, the new helper has the intended structure, and a Chair create, a public submission and replay, a legacy hex code and the 99 to 100 boundary all behave. The 21 October dry run followed the same pattern for migrations 22 to 26.

**Shape (Proposed for hosted, Verified locally on PGlite).** One `execute_sql` call whose text is, in this order:

1. **Part 1:** the migration file, byte for byte, with nothing added or removed (`cat supabase/migrations/20261021140000_sequential_chair_numbering.sql`). Today it is the only pending migration; if more were pending, they go here in filename order.
2. **Part 2:** the block below, which ends with `RAISE EXCEPTION`, so the statement fails and **everything in it rolls back**.

Do **not** add `BEGIN` or `COMMIT`. Without an explicit `BEGIN`, a multi-statement string sent as one simple query is one implicit transaction in PostgreSQL, the final error aborts all of it, and no open transaction is left on a pooled connection. That the connector sends the text as one simple query is **Untested (hosted)**; the post-check in 4.2 is what proves the rollback happened.

### 4.1 Part 2 (append after the migration text)

```sql
-- PART 2 of the dry run: runs in the SAME implicit transaction as the migration text above it.
-- Everything, including the throwaway fixture, is rolled back by the final RAISE EXCEPTION.
do $dry$
declare
  conf uuid := gen_random_uuid(); com uuid := gen_random_uuid(); ses uuid := gen_random_uuid();
  sch uuid := gen_random_uuid(); del uuid := gen_random_uuid(); usr uuid := gen_random_uuid();
  tok text := 'DRYRUN' || repeat('Z', 34);
  m1 uuid := gen_random_uuid(); s1 uuid := gen_random_uuid();
  r jsonb; got text; n int; helper_denied boolean := false;
  trail text[] := '{}'; func_error text := null;
  helper constant regprocedure := 'private.next_resolution_code(uuid,uuid)'::regprocedure;
begin
  -- A. Structure of the new helper and the two patched bodies (migration-owner view). A failure here is a hard stop.
  if not exists (select 1 from pg_proc p where p.oid = helper and p.prosecdef and p.proconfig @> array['search_path=""']) then
    raise exception 'DRYRUN_FAIL helper is not security definer with an empty search_path'; end if;
  if has_function_privilege('anon', helper, 'execute') or has_function_privilege('authenticated', helper, 'execute')
     or has_function_privilege('service_role', helper, 'execute') or has_function_privilege('public', helper, 'execute') then
    raise exception 'DRYRUN_FAIL helper is executable by a client role'; end if;
  if pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure) not like '%private.next_resolution_code(conf,cid)%'
     or pg_get_functiondef('public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)'::regprocedure) not like '%private.next_resolution_code(link.conference_id, link.committee_id)%' then
    raise exception 'DRYRUN_FAIL a patched function does not call the helper'; end if;
  if (select count(*) from pg_proc p where p.proname = 'next_resolution_code') <> 1 then raise exception 'DRYRUN_FAIL helper count'; end if;
  -- These md5 values are what the real apply must reproduce (compare after step 6).
  trail := array_append(trail, 'structure=ok');
  trail := array_append(trail, 'apply_mutation_md5=' || md5(pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure)));
  trail := array_append(trail, 'submit_resolution_md5=' || md5(pg_get_functiondef('public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)'::regprocedure)));
  trail := array_append(trail, 'helper_md5=' || md5(pg_get_functiondef(helper)));

  -- B. Functional checks on a throwaway synthetic fixture, through the real RPCs. A failure here is reported, not raised,
  --    so one harness problem cannot hide the structural result; the final message says which it was.
  begin
    insert into auth.users(id) values (usr);
    insert into public.conferences(id,name,venue,date) values (conf,'DRYRUN TEST (rolled back)','TEST DATA - not a real conference',current_date);
    insert into public.committees(id,conference_id,code,name,room) values (com,conf,'TST','TST committee','Room');
    insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values (ses,conf,com,'Session 1',now(),'scheduled');
    insert into public.schools(id,conference_id,name) values (sch,conf,'DRYRUN School (not real)');
    insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email) values (del,conf,com,sch,'France','DRYRUN Delegate','dryrun-delegate@example.com');
    insert into public.submission_links(conference_id,committee_id,token) values (conf,com,tok);
    insert into public.user_access(conference_id,user_id,role,committee_id,expires_at) values (conf,usr,'chair',com,now()+interval '1 hour');

    -- Chair creates (authenticated role, auth.uid() = usr): 01, 02, 03, then a replay of the first mutation id.
    perform set_config('request.jwt.claim.sub', usr::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', usr::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.apply_conference_mutation(conf, m1, jsonb_build_object('type','newDocument','committeeId',com,'sessionId',ses,'title','Draft','submitterId',del), 'chair', null, now());
    perform public.apply_conference_mutation(conf, gen_random_uuid(), jsonb_build_object('type','newDocument','committeeId',com,'sessionId',ses,'title','Draft','submitterId',del), 'chair', null, now());
    perform public.apply_conference_mutation(conf, gen_random_uuid(), jsonb_build_object('type','newDocument','committeeId',com,'sessionId',ses,'title','Draft','submitterId',del), 'chair', null, now());
    perform public.apply_conference_mutation(conf, m1, jsonb_build_object('type','newDocument','committeeId',com,'sessionId',ses,'title','Draft','submitterId',del), 'chair', null, now());
    begin
      perform private.next_resolution_code(conf, com);
    exception when insufficient_privilege then helper_denied := true;
    end;
    reset role;
    select count(*) into n from public.documents where committee_id = com;
    if n <> 3 then raise exception 'DRYRUN_FAIL replay changed the document count: %', n; end if;
    select string_agg(code, ',' order by code) into got from public.documents where committee_id = com;
    if got <> 'TST / 01,TST / 02,TST / 03' then raise exception 'DRYRUN_FAIL chair sequence: %', got; end if;
    if not helper_denied then raise exception 'DRYRUN_FAIL authenticated could call the helper'; end if;
    trail := array_append(trail, 'chair=' || got);

    -- Public submission (service_role) takes the next number; an identical replay returns the same one.
    set local role service_role;
    r := public.submit_resolution(tok, s1, del, 'Protecting civilians online', rpad('dryrun', 30, 'x'), null, null, null, null);
    if r->>'code' <> 'TST / 04' then raise exception 'DRYRUN_FAIL public number: %', r; end if;
    r := public.submit_resolution(tok, s1, del, 'Protecting civilians online', rpad('dryrun', 30, 'x'), null, null, null, null);
    reset role;
    if r->>'status' <> 'replayed' or r->>'code' <> 'TST / 04' then raise exception 'DRYRUN_FAIL public replay: %', r; end if;
    trail := array_append(trail, 'public=' || (r->>'code') || '/' || (r->>'status'));

    -- A legacy hex code is ignored by the counter.
    insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values (gen_random_uuid(),conf,com,ses,del,'TST / ca7640bb','Legacy');
    set local role authenticated;
    perform public.apply_conference_mutation(conf, gen_random_uuid(), jsonb_build_object('type','newDocument','committeeId',com,'sessionId',ses,'title','Draft','submitterId',del), 'chair', null, now());
    reset role;
    if not exists (select 1 from public.documents where committee_id = com and code = 'TST / 05') then raise exception 'DRYRUN_FAIL legacy hex moved the counter'; end if;
    trail := array_append(trail, 'legacy_hex_ignored=ok');

    -- The 99 to 100 boundary for both paths (06..99 seeded as the owner, as the local boundary test does).
    insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title)
      select gen_random_uuid(),conf,com,ses,del,'TST / '||lpad(g::text,2,'0'),'Seed' from generate_series(6,99) g;
    set local role authenticated;
    perform public.apply_conference_mutation(conf, gen_random_uuid(), jsonb_build_object('type','newDocument','committeeId',com,'sessionId',ses,'title','Draft','submitterId',del), 'chair', null, now());
    reset role;
    if not exists (select 1 from public.documents where committee_id = com and code = 'TST / 100') then raise exception 'DRYRUN_FAIL 99 to 100 (chair)'; end if;
    set local role service_role;
    r := public.submit_resolution(tok, gen_random_uuid(), del, 'Protecting civilians online', rpad('dryrun2', 30, 'x'), null, null, null, null);
    reset role;
    if r->>'code' <> 'TST / 101' then raise exception 'DRYRUN_FAIL 100 to 101 (public): %', r; end if;
    trail := array_append(trail, 'boundary=100,101');
  exception when others then
    func_error := sqlerrm;          -- the sub-transaction (fixture, role and settings) is rolled back; carry on as the owner
  end;

  if func_error is not null then
    raise exception 'DRYRUN_STRUCTURE_OK_FUNCTIONAL_NOT_RUN % | functional_error=% (everything in this transaction is rolled back)', array_to_string(trail, '; '), func_error using errcode = 'P0001';
  end if;
  raise exception 'DRYRUN_OK % (everything in this transaction is rolled back by this exception)', array_to_string(trail, '; ') using errcode = 'P0001';
end $dry$;
```

Hosted caveat (**Untested**): the harness inserts one row into `auth.users(id)` and uses `SET LOCAL ROLE`. If the hosted `auth.users` refuses a row with only an id, replace that insert by selecting an existing **synthetic anonymous** user (`select id from auth.users where is_anonymous limit 1`), which must not already hold a grant in the fixture conference (the conference is new, so it does not). A harness error is reported as `DRYRUN_STRUCTURE_OK_FUNCTIONAL_NOT_RUN` and is not by itself a migration problem; fix the harness and rerun.

### 4.2 Expected outputs and what each means

| Result | Meaning | Action |
| --- | --- | --- |
| Error `apply_mutation newDocument numbering anchor changed; review before applying` or `submit_resolution numbering anchor changed; review before applying` | The hosted function bodies differ from the repository chain. The migration cannot be applied as written. | **STOP.** Do not apply. Capture 3.2 C1b and take it to review. |
| Any other error before `DRYRUN_`, for example a syntax error or `function ... already exists` | The pending text is not what was reviewed, or the migration is already (partly) applied. | **STOP.** Re-run T4 and T5; compare the file MD5 with A3. |
| Error with message starting `DRYRUN_FAIL` | A structural check failed (helper not `SECURITY DEFINER` with empty `search_path`, executable by a client role, patched body does not call the helper, or the wrong helper count). | **STOP.** |
| Error `DRYRUN_STRUCTURE_OK_FUNCTIONAL_NOT_RUN structure=ok; ...; apply_mutation_md5=...; submit_resolution_md5=...; helper_md5=... \| functional_error=<text>` | The migration text applies cleanly and is structurally correct; the functional harness failed. | Decide whether the failure is the harness (see the caveat) or the migration (a `DRYRUN_FAIL ...` text inside `functional_error` means a numbering result was wrong: **STOP**). Do not apply on this result alone; rerun until `DRYRUN_OK`, or record an owner decision to apply on structure alone. |
| Error `DRYRUN_OK structure=ok; apply_mutation_md5=<32 hex>; submit_resolution_md5=<32 hex>; helper_md5=<32 hex>; chair=TST / 01,TST / 02,TST / 03; public=TST / 04/replayed; legacy_hex_ignored=ok; boundary=100,101 (everything in this transaction is rolled back by this exception)` | **Pass.** Record the three MD5 values: the real apply must reproduce them (step 5.6). | Run the post-check below, then proceed only if it also passes. |
| A **success** result (no error) | The final `RAISE` did not run, so something may have **committed**. | **STOP immediately.** Run T4 and T5. If the helper exists or the ledger changed, treat as an unplanned apply and escalate to the owner. |

The exact message framing (for example a `P0001` prefix or the connector's error wrapper) is **Untested (hosted)**; match on the `DRYRUN_` text.

**Post-check (read-only, mandatory after every dry run, expected exactly as stated):**

```sql
select to_regprocedure('private.next_resolution_code(uuid,uuid)') as helper,                       -- NULL
       (select count(*) from supabase_migrations.schema_migrations) as ledger_rows,                 -- 26
       (select count(*) from public.conferences where name like 'DRYRUN%') as dryrun_conferences,   -- 0
       (select count(*) from auth.users) as auth_users;                                             -- equal to the count before the dry run
```

Take the `auth_users` count (and the conference count) before the dry run as well, and re-run section 3.2 C1: the two `def_md5` values must equal their values from before the dry run. A difference means the dry run changed the database: **stop** and escalate.

## 5. Apply procedure (one migration)

Prerequisites: A1 to A7 satisfied; T1 to T5 pass; 3.1 returns zero rows; 3.2 saved; the dry run ended in `DRYRUN_OK` and its post-check is clean; the file MD5 still equals A3.

| Step | Action | Status |
| --- | --- | --- |
| 5.1 | Re-run T4 (ledger 26) and T5 (helper absent) immediately before applying. | **Proposed** |
| 5.2 | Apply **exactly this file once** with the Supabase connector's `apply_migration`: `name` = `sequential_chair_numbering`, `query` = the file text, byte for byte. One migration per call, as on 21 October. Do not split the file, do not paste a modified copy, do not use the CLI with `--include-all`. The CLI (`supabase db push`) is an acceptable alternative for the owner; the ledger version is then already the filename version and step 5.4 is skipped. | **Proposed** (connector used this way on 21 October for migrations 22 to 26; the apply-time version it records was then corrected by hand) |
| 5.3 | If the call times out or errors, **do not retry**. Run T4 and T5 first. If the helper exists and the ledger has a new row, the apply happened: continue at step 5.4. If neither exists, nothing happened. If the helper exists with **no** ledger row, or the ledger row exists but a caller is still unpatched (check step 5.6), stop: that is a partial apply and needs owner review (see section 7). A second attempt would fail on `create function private.next_resolution_code` and patch nothing. | **Proposed**; connector atomicity is **Untested (hosted)** |
| 5.4 | Set the ledger version to the filename version, as on 21 October. First confirm no row already has the target version: `select 1 from supabase_migrations.schema_migrations where version = '20261021140000'` returns nothing. Then, with the connector's apply-time version read from the ledger: `update supabase_migrations.schema_migrations set version = '20261021140000' where version = '<connector version>' and name = 'sequential_chair_numbering';` must report **one** row. Do not edit `statements`. | **Proposed** (the same manual correction was made for 22 to 26) |
| 5.5 | Ledger now has **27 rows**, versions and names equal to the filenames: re-run 3.1 with the 27th line `('20261021140000','sequential_chair_numbering')` added; expected zero rows. | **Proposed** |
| 5.6 | Confirm the apply equals the dry run: re-run the MD5 queries of 3.2 C1; `def_md5` for both functions must equal the `apply_mutation_md5` and `submit_resolution_md5` recorded from `DRYRUN_OK`, and `md5(pg_get_functiondef('private.next_resolution_code(uuid,uuid)'::regprocedure))` must equal `helper_md5`. Run the statement MD5 of 3.3: equals A3 when `parts = 1`. | **Proposed**; the equality is expected because both runs execute the same text on the same bodies, but it is **Untested (hosted)** |

### 5.7 Abort and rollback criteria

**Before the apply (do not apply):** any T or ledger check fails; anchor error in the dry run; any `DRYRUN_FAIL`; a dry run that returned success or left any object behind; file MD5 differs from the reviewed one; non-test data found; a second person is changing the project; approvals A1 to A5 not recorded.

**After the apply (decide to revert):**

| Observation | Decision |
| --- | --- |
| Steps 5.5 or 5.6 differ from the dry run, or the helper is missing or has an ACL other than `{postgres=X/postgres}`, or a client role can execute it | **Revert** (section 7) and stop; this is a different object from the one reviewed. |
| A Chair create or a public submission **errors** where it worked before, in the synthetic checks of section 8 | **Revert.** These are conference-day flows. |
| Numbers are wrong, duplicated, skipped, or a number is consumed by a retry | **Revert** and report; the central claim of the migration failed. |
| Behaviour correct but evidence incomplete (for example a connector timeout on a read) | Do **not** revert. Finish or repeat the check. Record it. |

A revert is itself a forward migration (section 7) and needs owner approval, a ledger row and the same dry-run discipline. Because the project holds only synthetic data, the cost of leaving the migration applied while investigating is low; the cost of an unreviewed hand edit is not.

## 6. Checksum and grant checks after the apply

All **Proposed** (hosted); the local equivalents are **Verified** (PGlite).

1. **Inventory diff.** Re-run 3.2 C2 and diff it against the saved output. Expected: **exactly one new row**, `private.next_resolution_code(conf uuid, committee uuid)`, with `owner` equal to the owner of the other `private` `SECURITY DEFINER` functions (locally `postgres`), `security_definer = true`, `config = {search_path=""}`, `acl = {postgres=X/postgres}`, `client_roles` empty, `public_execute = false`. **Every other row is identical**, including `private.apply_mutation` (executable by `authenticated`, as before) and `public.submit_resolution` (executable by `service_role` only, as before). `create or replace` through `execute definition` keeps owner and ACL; a changed ACL on either patched function is a **stop**.
2. **Not exposed.** The helper must not be reachable through the API. `private` is not an exposed schema, so with the publishable key from the operator's shell (never printed) and an authenticated device session: `POST <url>/rest/v1/rpc/next_resolution_code` must **not** return 2xx (expect a not-found or invalid-schema error); the same with header `Content-Profile: private`. Also `select has_schema_privilege('anon','private','usage'), has_schema_privilege('authenticated','private','usage')` is recorded: the 21 October record says `anon` has no `USAGE` on `private`; `authenticated` uses `private.apply_mutation` through its `public` wrapper. Any 2xx from the helper over HTTP is a **stop and revert** (section 7). **Untested (hosted).**
3. **Existing exposure unchanged.** `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and has_function_privilege('anon', p.oid, 'execute')` equals its pre-apply value (0 on the 21 October record).
4. **Advisors.** Re-run the Supabase security advisors; the same four access-code `SECURITY DEFINER` warnings and the generic anonymous-policy notices as the 21 October record, nothing new naming `next_resolution_code`. **Untested (hosted)** for this migration.
5. **Statement MD5** per section 3.3.

## 7. Revert: forward-only

**Verified** (read): migrations are never edited after apply ([AGENTS.md](../AGENTS.md) protected area 3). Migration 27 is `create or replace function` patches plus one new helper, so it leaves no schema to undo; reverting means a **new forward migration** (28) that restores the previous function bodies. Documents numbered by migration 27 (`TST / 03`) stay valid and unique after a revert; a later public submission then uses the old `count(*) + 1` plus skip loop, which still avoids any code in use.

**Where the previous bodies are.** There is **no single repository file** that holds them, because both functions are rebuilt by successive `pg_get_functiondef` plus anchor patches. The header of the migration points at the git history of `20261006073442` and `20261006023111`; that is **stale**: `private.apply_mutation` was patched afterwards by `20261007104501_staff_schedule_amendments`, `20261009120000_procedure_usability` and `20261021110000_clear_majority`, and `public.submit_resolution` by `20261007104501_staff_schedule_amendments` (archived-committee guard), so those two files alone would restore an older behaviour, not the previous one. The authoritative previous bodies are therefore, in order of preference:

1. **The inverse patch (preferred, Verified locally).** A migration that applies the same anchor technique in reverse. It restored both functions to byte-identical definitions (equal `md5(pg_get_functiondef)`) after migration 27 on PGlite. Proposed content for `supabase/migrations/<timestamp>_revert_sequential_chair_numbering.sql`, which must be reviewed, replayed from empty locally, tested (create, public submit, replay) and then **kept unapplied**:

```sql
create function pg_temp.patch_back(definition text, anchor text, replacement text, label text) returns text language plpgsql as $$
begin if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then raise exception '% changed; review before reverting',label; end if; return replace(definition,anchor,replacement); end $$;
do $revert$ declare d text; begin
 d := pg_get_functiondef('private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)'::regprocedure);
 d := pg_temp.patch_back(d, $q$private.next_resolution_code(conf,cid),command->>'title' from public.committees c where c.id=cid;$q$,
  $q$c.code||' / '||substr(new_id::text,1,8),command->>'title' from public.committees c where c.id=cid;$q$, 'apply_mutation revert anchor');
 execute d;
 d := pg_get_functiondef('public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)'::regprocedure);
 d := pg_temp.patch_back(d, $q$ doc_code := private.next_resolution_code(link.conference_id, link.committee_id);
$q$, $q$ select count(*) + 1 into n from public.documents where committee_id = link.committee_id;
 loop
   doc_code := committee_code || ' / ' || lpad(n::text, 2, '0');
   exit when not exists(select 1 from public.documents where conference_id = link.conference_id and code = doc_code);
   n := n + 1;
 end loop;
$q$, 'submit_resolution revert anchor');
 execute d;
end $revert$;
drop function private.next_resolution_code(uuid, uuid);
```

   The `drop function` line is optional (leaving the unused helper is harmless: no grants) and is a review decision. Its dependants are gone once both bodies are reverted; a `plpgsql` body does not record a dependency, so the drop must come **after** the two `execute d` statements. (The inverse patch itself, without the `drop`, is what was verified.)
2. **The saved pre-apply text** (3.2 C1b) is the cross-check: after the revert, `md5(pg_get_functiondef(...))` of both functions must equal the hosted pre-apply `def_md5` values.
3. **A full replay.** Replay migrations 1 to 26 from empty on local PostgreSQL 17 and capture `pg_get_functiondef` of both functions; this is what the previous bodies are, independent of any comment. Use it to review the revert migration.

If the owner decides an incident needs the previous bodies **before** a reviewed migration exists, the saved text from 3.2 C1b may be run once by a human with an explicit owner instruction, and a ledger-backed migration recording the same change must follow immediately. That is a deliberate exception to "apply schema changes only through committed migrations" and is the owner's to grant, never an agent's.

**Optional hygiene (does not affect this procedure):** the stale pointer in the migration header could be corrected in a comment-only change **before** the apply; it would change the file MD5 (A3) and need re-review, so the recommendation is to leave the file as reviewed and rely on this section.

## 8. Synthetic verification in an isolated TEMPORARY conference

Only after sections 5 and 6 pass. The conference is new, labelled, small and has its own credentials, so the original test conference, its two active credentials and its Draft document are untouched. This follows the 21 October pattern (a second labelled conference with its own short-lived credentials bootstrapped by hash). It does **not** create another hosted database.

**Never print, log or paste a code.** Raw codes live in files with mode 0600 outside the repository, or in an operator's environment variable. SQL below contains SHA-256 digests only.

### 8.1 Create the conference by hash-only credential insert (Proposed; the credential mechanism is Verified locally)

Generate three codes locally. Each command writes the raw code to a private file and prints **only the digest**:

```
node -e "const c=require('crypto'),fs=require('fs');const raw=c.randomBytes(12).toString('hex').toUpperCase();fs.writeFileSync(process.argv[1],raw+'\n',{mode:0o600});console.log(c.createHash('sha256').update(raw).digest('hex'))" /private/outside-repo/numbering-exec.code
```

Repeat for `numbering-chair-tst.code` and `numbering-chair-bnd.code`. The raw value is 24 uppercase hexadecimal characters; `redeem_access_code` strips spaces and dashes and upper-cases, then hashes the 24 characters with SHA-256, so the digest above is what the database expects (**Verified locally**; this is the same format as [`scripts/bootstrap-first-executive.sql`](../scripts/bootstrap-first-executive.sql), which instead generates the code in the database and shows it once). Use that script only if the database should generate the Executive code and a person will read it from the result row.

Run once, with the three digests substituted (**Proposed**; all names carry TEST markers so the rehearsal preflight and the cleanup recognise them):

```sql
do $setup$
declare
  conf uuid := gen_random_uuid();
  tst uuid := gen_random_uuid(); bnd uuid := gen_random_uuid();
  s_t uuid := gen_random_uuid(); s_b uuid := gen_random_uuid();
  sess_t uuid := gen_random_uuid(); sess_b uuid := gen_random_uuid();
  school uuid := gen_random_uuid();
begin
  insert into public.conferences(id,name,venue,date) values (conf,'DCMUN Development Test (temporary numbering check)','TEST DATA - not a real conference - temporary',current_date);
  insert into public.schools(id,conference_id,name) values (school,conf,'TEST School (not real)');
  insert into public.committees(id,conference_id,code,name,room) values (tst,conf,'TST','TEST Committee (not real)','TEST Room'),(bnd,conf,'BND','TEST Boundary Committee (not real)','TEST Room');
  insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values (sess_t,conf,tst,'TEST Session 1',now(),'scheduled'),(sess_b,conf,bnd,'TEST Session 1',now(),'scheduled');
  update public.committees set "currentSessionId" = sess_t where id = tst;
  update public.committees set "currentSessionId" = sess_b where id = bnd;
  insert into public.delegates(conference_id,committee_id,"schoolId",country,name,email) values
    (conf,tst,school,'France','TEST Delegate T1','numbering-t1@example.com'),(conf,tst,school,'Japan','TEST Delegate T2','numbering-t2@example.com'),
    (conf,bnd,school,'Brazil','TEST Delegate B1','numbering-b1@example.com'),(conf,bnd,school,'Kenya','TEST Delegate B2','numbering-b2@example.com');
  insert into public.submission_links(conference_id,committee_id,token) values
    (conf,tst,'NUMTST'||repeat('Z',34)),(conf,bnd,'NUMBND'||repeat('Z',34));
  insert into private.access_credentials(conference_id,committee_id,role,credential_hash,expires_at,created_by) values
    (conf,null,'admin','<sha256 digest of the Executive code>', now()+interval '6 hours', null),
    (conf,tst,'chair','<sha256 digest of the TST Chair code>', now()+interval '6 hours', null),
    (conf,bnd,'chair','<sha256 digest of the BND Chair code>', now()+interval '6 hours', null);
end $setup$;
select id as conference_id, name from public.conferences where name like 'DCMUN Development Test (temporary numbering check)%';
```

Record the printed `conference_id` as the temporary conference (**the only conference id used below**; every later query filters on it). Short validity (6 hours) is deliberate. The submission link tokens above satisfy the `^[A-Za-z0-9_-]{22,64}$` check; they are placeholders for the temporary conference only.

### 8.2 SQL-level numbering checks against the real, committed hosted function (Proposed)

Each as a separate `execute_sql`, filtered on the temporary conference. These repeat the dry run, now committed, and add what a rolled-back transaction cannot show.

| # | Check | Expected |
| --- | --- | --- |
| S1 | Sequence 01..N: three Chair creates (section 8.3) then `select code from public.documents where committee_id = <TST> order by code` | `TST / 01`, `TST / 02`, `TST / 03` |
| S2 | A public submission, called as the migration owner (the function is `SECURITY DEFINER`; its `service_role`-only grant is checked in section 6, the role switch was exercised in the dry run): `select public.submit_resolution('<NUMTST token>', <new uuid>, <TST delegate id>, 'Protecting civilians online', rpad('numbering',30,'x'), null,null,null,null);` | `status: created`, next number; calling again with the **same** submission id returns `status: replayed` and the **same** code, and the count of documents does not change |
| S3 | Legacy hex code ignored: as owner insert `TST / ca7640bb` and `TST / 12345678` (documents need session, submitter, code, title) then create one more | The next number continues after the highest sequential code; the hex codes are untouched and not renumbered |
| S4 | `/99` to `/100`: for committee `BND`, seed 01..98 as owner (`insert ... select ... from generate_series(1,98)`), then create three (Chair or public) | `BND / 99`, `BND / 100`, `BND / 101` (never `BND / 10`) |
| S5 | Uniqueness backstop: `select count(*) = count(distinct code) from public.documents where conference_id = <temp conference>` | `true` |

### 8.3 Chair numbering through the real API, concurrency and retries (Proposed script, hosted behaviour Untested)

The app's own client code is the path under test: `redeemStaffCode` (device redeems the TST Chair code, creating an anonymous identity and grant) and `SupabaseTransport.send`, which calls `apply_conference_mutation` over PostgREST ([`lib/access-codes.ts`](../lib/access-codes.ts), [`lib/supabase/repository.ts`](../lib/supabase/repository.ts)). [`scripts/smoke-project.mts`](../scripts/smoke-project.mts) is the pattern to copy. **There is no committed script for this check**; a guarded `scripts/verify-numbering-hosted.mts` is a recommended follow-up (section 11) and needs owner approval. Until then the check is an ad hoc script kept **outside the repository** (a scratch directory) that must:

1. Call `assertToolTarget(process.env.NEXT_PUBLIC_SUPABASE_URL)` first and exit if it throws; read `NEXT_PUBLIC_CONFERENCE_ID` and require it to equal the temporary conference id; require the conference name to carry `TEST`/`temporary` (the same marker the rehearsal preflight uses, [`scripts/rehearsal/offline-hosted.mts`](../scripts/rehearsal/offline-hosted.mts)).
2. Read the Chair code from the 0600 file, never print it, redeem it on **several** separate clients (separate anonymous identities, one per simulated device).
3. Run, each as its own phase, and print only ids, codes of the form `TST / NN`, and pass or fail:
   * **Sequence:** one Chair, `newDocument` x 5 sequentially. Expect the five existing-plus-new numbers to be consecutive.
   * **Concurrent Chair and Chair:** with `Promise.all`, send N (for example 8) `newDocument` commands from 3 identities at the same time. Expect N new, distinct, consecutive numbers and no gap. (Real PostgREST concurrency is **Untested (hosted)**; the PostgreSQL 17 version is the CI test above.)
   * **Concurrent Chair and public:** only if the owner supplied `SUPABASE_SECRET_KEY` (A6): fire Chair creates and `submit_resolution` calls (through the server-role client, or the app's `/api/submissions` route on a local `next start`) together. Expect distinct consecutive numbers across both. Otherwise record this check as **Untested (hosted)**, covered only in CI.
   * **Retries:** send the same mutation id 5 times sequentially and 5 times concurrently. Expect one new document and one number consumed; the next fresh create gets the next number, with no gap.
   * **Idempotency replay with a changed payload:** reuse a mutation id with a different title or committee. Expect a refusal (`Idempotency key reused`, as in the smoke test), no new document, no number consumed.
   * **Role boundary:** the TST Chair creating a draft in `BND` is refused (42501); the helper is not callable (section 6, item 2).

Counts are reported as deltas from a baseline read at the start of each phase, so a phase can be repeated.

### 8.4 Signed-in browser and API checks (Proposed; the 21 October run is the precedent)

Run a build of the exact commit against the temporary conference: `NEXT_PUBLIC_DATA_BACKEND=supabase`, the project URL and publishable key, `NEXT_PUBLIC_CONFERENCE_ID` set to the temporary conference id, and `STAGING_SUPABASE_REFS` set (see [DATABASE_BACKED_DEPLOYMENT.md](DATABASE_BACKED_DEPLOYMENT.md#4-how-the-app-is-built-in-supabase-mode)). A local `npm run build` then `npm start` is sufficient and needs no Vercel change; a protected deployment is the option described in that document. Check:

1. Chair signs in with the TST code (the staff access-code gate), creates three resolutions (**New resolution** has no title field): the identity shows `TST/01`, `TST/02`, `TST/03` (the display drops the spaces round the slash, [`lib/resolution-identity.ts`](../lib/resolution-identity.ts)), each with the Main Submitter's country, and the numbers survive a reload.
2. After sync, the number each device shows equals `documents.code` on the server. The client computes an optimistic number first ([`lib/commands.ts`](../lib/commands.ts) `newDocument`) and the server decides; **observe and record** whether a draft created while another device or a public submission took the same number shows a different number after sync (not a data problem, but a visible change).
3. A second Chair device on the same committee (a second identity redeeming the same code) creates a draft: the number continues the same sequence.
4. Offline: take one device offline, create a draft, create another elsewhere, reconnect. One action, one document, no duplicate, numbers distinct (the offline outbox and `PT409`/idempotency contract, [AGENTS.md](../AGENTS.md) protected area 5). **Untested (hosted)** with sequential numbers.
5. A public submission: if the server key is available, submit through `/submit/<token>` on the local build and confirm the next number; otherwise this stays **Untested (hosted)**.
6. Approval inbox shows the resolution with its country; Logistics print queue shows print copies (delegates + 3); the Executive overview lists the codes. (These screens were verified on 21 October for hex-coded drafts; the numbering change should not alter them.)
7. No page errors in any session.

### 8.5 Revoke-only cleanup

**Only the credentials and grants of the temporary conference are revoked.** Nothing is deleted (deletion is the guarded cleanup of [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md), item 1.9.5 and cutover step 2.2). **Proposed**, `<temp>` is the temporary conference id, run last:

```sql
update private.access_credentials set revoked_at = now(), updated_at = now() where conference_id = '<temp>' and revoked_at is null;
update public.user_access set revoked_at = now(), updated_at = now() where conference_id = '<temp>' and revoked_at is null;
-- Verify: both must return 0
select count(*) from private.access_credentials where conference_id = '<temp>' and revoked_at is null;
select count(*) from public.user_access where conference_id = '<temp>' and revoked_at is null;
```

(Columns confirmed in the migrations and by a local query: `private.access_credentials` has `revoked_at` and `updated_at`; `public.user_access` has `revoked_at` and `updated_at`.) Then confirm the **original test conference is untouched**: its two active credentials and 8 active grants (per the 21 October record) and its Draft document are as before, and the ledger has 27 rows.

**What remains for the guarded deletion at cutover:** the temporary conference row and everything under it (committees, schools, delegates, sessions, documents and their versions, submission links and `private.resolution_submissions` receipts, `private.mutation_receipts`, `public.audit_log` rows), the anonymous `auth.users` rows created by the test devices and their refresh sessions, any Storage objects, and the revoked credential and grant rows, which stay as rows until deletion. Revoked is not removed.

## 9. Evidence capture and stop conditions

### 9.1 Evidence template

Record in a **new section appended to [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md)** ("Migration 27, 2026-MM-DD", in the style of "Migrations 22 to 26"), in the same reviewed change that updates the "26" counts in that file and in [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) (see section 11). Raw query output stays with the operator, outside the repository.

| Field | Record |
| --- | --- |
| Run | Date and time (UTC), operator, who approved (A1), reviewer (A2) |
| Commit | Exact `main` SHA, file name, trimmed MD5 of the file (A3) |
| Target | Ref and URL (T1, T2), region and Postgres version, `EXPECTED_SUPABASE_REF` unset, allow-list used |
| Data check | T3 results (zero rows, counts) |
| Ledger before | Row count (26), 3.1 result (zero rows) |
| Capture | The two `def_md5` values and saved function text location (3.2 C1, C1b); inventory file name (3.2 C2) |
| Dry run | Verbatim final message (`DRYRUN_OK ...` with the three MD5 values), post-check results |
| Apply | Method (`apply_migration` or CLI), connector version before the fix, the ledger `update` result (one row), time taken |
| Ledger after | Row count (27), 3.1 result (zero rows), statement MD5 and `parts` |
| Reconciliation | Step 5.6: the three MD5 values equal the dry run |
| Grants | Inventory diff (one new row), ACL of the helper, HTTP refusal of the helper, advisors |
| Synthetic checks | Temporary conference id, S1 to S5, 8.3 phases (sequence, concurrency, retries, replay, boundary), 8.4 browser items, anything **Untested** and why |
| Cleanup | The two zero counts, original conference untouched |
| Decision | Left applied, or revert required (and the reason) |

### 9.2 Stop conditions (any one stops the run; nothing is "worked around")

* Ref not exactly the expected one, PHESMUN ref anywhere, `EXPECTED_SUPABASE_REF` set, or a second hosted project involved.
* Any real-looking data, a non-`example.com` delegate email or a non-anonymous auth user.
* Ledger not 26 before, or not 27 after, or any version or name differing from the filenames.
* File MD5 differs from the reviewed one; any anchor error; any `DRYRUN_FAIL`; a dry run that does not roll back.
* A connector timeout followed by retry (never retry before T4 and T5).
* An unexpected grant, owner, `search_path` or ACL on the helper, or any change to another function's ACL; the helper reachable over HTTP.
* A duplicate, skipped or retry-consumed number, or any error from a Chair create or public submission that worked before.
* A code, key or token about to be printed, pasted or committed.
* Any step that would run after promotion, or without the recorded approvals.

## 10. Verified, proposed and untested at a glance

| Area | Status |
| --- | --- |
| Migration content, helper semantics, range, locking, idempotency | **Verified** (file read; PGlite tests passed in this session) |
| Real-connection concurrency (Chair vs Chair, Chair vs public, same mutation id, boundaries) | **Verified in CI only** (PostgreSQL 17); not run here; **Untested (hosted)** |
| Dry-run SQL shape and outputs | **Verified locally** (PGlite); **Untested (hosted)** |
| Inverse patch restores byte-identical bodies | **Verified locally** (PGlite); revert migration **Proposed**, unreviewed |
| Hash-only credential insert and redemption | **Verified locally** (PGlite); **Untested (hosted)** |
| Anchors match the hosted function bodies | **Untested (hosted)** for this migration (the 21 October dry run covered 22 to 26 only) |
| Connector atomicity and stored statement shape for MD5 | **Untested (hosted)** |
| Helper unreachable over HTTP; advisors | **Untested (hosted)** |
| Concurrency, retries, offline and browser behaviour on the hosted project | **Untested (hosted)** |
| Public `/submit/<token>` path with sequential numbers | **Untested (hosted)** (needs the server key, A6) |

## 11. Gaps found while preparing this procedure

1. **No committed hosted numbering verification.** The concurrency and retry checks in 8.3 rely on an ad hoc script. Recommended: a guarded `scripts/verify-numbering-hosted.mts` modelled on `scripts/smoke-project.mts` and the hosted preflight in `scripts/rehearsal/offline-hosted.mts` (target guard, temporary-conference marker, no printed codes). Needs owner approval; not created here.
2. **The migration header's rollback pointer is stale** (section 7): it names `20261006073442` and `20261006023111`, but the previous bodies come from the whole chain.
3. **Documents still say 26 migrations and "no migration 27 is planned".** [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md) (status line, ledger "26 rows", and the "Finding" that Chair drafts are hex-numbered), [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) (owner-approval gate "None is planned", cutover step 2.1 "26 files") and [DEPLOYMENT.md](DEPLOYMENT.md) need one coordinated update when 27 is applied; this change does not edit them.
4. **No recorded independent review of the migration** in the repository (A2).
5. **The hosted dry run and apply here assume the connector behaves as on 21 October** (single transaction, stored statements, apply-time version); none of that is guaranteed.
6. **No stored hosted PostgreSQL 17 function inventory.** The task's "local PG17 inventory" does not exist as a committed artifact; only CI exercises PostgreSQL 17. This session's inventory is PGlite (PostgreSQL 18.3) and is reproduced by the query in 3.2 C2.
