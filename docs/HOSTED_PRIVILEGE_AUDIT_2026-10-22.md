# Hosted privilege audit, 22 October 2026 (A14)

Record of a **read-only** audit of the preproduction Supabase project (ref `kllhswucdhqqywnzxado`, dashboard name "DCMUN Staging", PostgreSQL 17.11, 26 migrations applied). Only catalog queries were run: no DDL, no DML, no function call, no setting change, no data read. This document records the result as given to the engineer preparing [PRIVILEGE_HARDENING.md](PRIVILEGE_HARDENING.md); the engineer who wrote it did not contact Supabase and did not see the raw output, only the summary below. Treat the numbers as the audit's, and the SQL below as the generic form of the queries (the same catalog reads as `collect()` in `scripts/isolation-inventory/inventory.mts`), not as a transcript.

The audit answers assumption **A14** of [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md) for the checked objects and **corrects the modelled baseline** the earlier feasibility work used (`service_role` with DML on every table was a model artefact).

## Result

| Area | Observed on hosted |
| --- | --- |
| Tables | 36 `public` tables. RLS enabled on all except the view `public.participation_history` (security-invoker view). Tables in `private`: no privileges for `anon`, `authenticated` or `service_role`. |
| `anon` | No table privileges; no function EXECUTE. |
| `authenticated` | SELECT only on the 36 `public` tables. EXECUTE on `public`: `access_code_status`, `apply_conference_mutation`, `apply_operations_mutation`, `conference_snapshot`, `conference_state_snapshot`, `executive_snapshot`, `executive_state_snapshot`, `operations_snapshot`, `redeem_access_code`, `revoke_access_code`, `rotate_access_code`, `staff_batch_snapshot`. EXECUTE on `private`: `access_grants`, `apply_mutation`, `apply_operations_mutation`, `apply_procedure`, `apply_staff_batch`, `decision_history`, `document_submitter_countries`, `has_access`, `permitted`, `photo_chairs`, `uuid_or_null`. |
| `service_role` | EXECUTE only on `public.amendment_link_info`, `submission_link_info`, `submit_amendment`, `submit_resolution`. **No SELECT/INSERT/UPDATE/DELETE on any `public` table.** It **does** hold TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on all 36 `public` tables. |
| Sequences, columns | No sequence privileges for the three roles; no column-level ACLs. |
| `pg_default_acl` | For role `postgres` in schema `public`: tables `{postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}`; sequences `{postgres=rwU}`; functions `{postgres=X}` only (new postgres-owned functions are not auto-granted to the API roles). `supabase_admin` defaults in `public` grant arwdDxtm / rwU / X to postgres, anon, authenticated, service_role; they affect only objects `supabase_admin` creates. |
| `PUBLIC` | No EXECUTE held by PUBLIC on any function in `public` or `private`. |

Consequences:

- The modelled "`service_role` can write all 36 tables" does not exist hosted. `docs/CONFERENCE_RELEASE_PLAN.md`, `ISOLATION_FEASIBILITY.md` and `ISOLATION_DESIGN.md` now say: modelled: yes; hosted audit 2026-10-22: no DML, but TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
- The four remaining privileges are not reachable through PostgREST (it exposes SELECT/INSERT/UPDATE/DELETE and RPC). They matter only to a caller with direct SQL as these roles. That is why the narrow HD2 is defense in depth and not a fix for a reachable bypass.
- The table default ACL would hand TRUNCATE/REFERENCES/TRIGGER/MAINTAIN to `anon`, `authenticated` and `service_role` on every table a later migration creates.
- `lib/platform/health-probe.ts` asserting "no table grants" is true for DML and false for those four.
- Hosted already matches what HD1 asks for at the per-schema level (`{postgres=X}`), so HD1 is expected to be a near no-op on hosted; what the audit did not read is a **global** (all-schema) default row for role `postgres`, which is what removes PUBLIC's implicit EXECUTE on new functions.

## Queries used (generic form, read-only)

```sql
-- version and ledger
select version();
select count(*), min(version), max(version) from supabase_migrations.schema_migrations;

-- tables / views / sequences: owner, RLS and ACL
select n.nspname, c.relname, c.relkind, pg_get_userbyid(c.relowner) owner, c.relrowsecurity rls, c.relacl
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S','f')
order by 1, 2;

-- effective table privileges per role (including PUBLIC and membership)
select r.r, p.p, count(*) from unnest(array['anon','authenticated','service_role']) r(r),
  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(p),
  pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and has_table_privilege(r.r, c.oid, p.p)
group by 1, 2 order by 1, 2;

-- effective function EXECUTE and PUBLIC execute
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) args,
  has_function_privilege('anon', p.oid, 'EXECUTE') anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') authenticated,
  has_function_privilege('service_role', p.oid, 'EXECUTE') service_role,
  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE') public_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and p.prokind in ('f','p')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by 1, 2, 3;

-- sequences and column-level ACLs
select c.relname, c.relacl from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','private') and c.relkind = 'S';
select c.relname, a.attname, a.attacl from pg_attribute a join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','private') and a.attacl is not null and not a.attisdropped;

-- default privileges (defaclnamespace = 0 is the GLOBAL row)
select pg_get_userbyid(d.defaclrole) owner, coalesce(n.nspname, '(global)') schema, d.defaclobjtype, d.defaclacl
from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace order by 1, 2, 3;
```

## What this audit does NOT cover (all Untested)

- **PostgREST exposed schemas** (`db-schemas`, `db-extra-search-path`) and whether `private` is reachable over HTTP (A3). The privilege results above say what the roles may do in SQL, not what the HTTP API exposes.
- **`storage`, `auth`, `extensions`, `realtime`, `graphql` and other Supabase-internal schemas**: grants, policies and functions there.
- **Objects owned by `supabase_admin`**, and their default privileges beyond what `pg_default_acl` showed.
- **Extensions and background jobs**: `pg_cron` jobs, `pg_net`, webhooks/database webhooks, event triggers, Edge Functions and their secrets.
- A **global** (all-schema) `pg_default_acl` row for role `postgres`, and whether hosted `postgres` (not a superuser) may run `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` and the revokes in the hardening migration (the aborted dry run in [PRIVILEGE_HARDENING.md](PRIVILEGE_HARDENING.md) answers this before anything is applied).
- Role attributes and memberships (`rolinherit`, `rolbypassrls`, who is a member of `service_role`), JWT `jwt_expiry`, and the secret/publishable key types.
- Anything after promotion: the audit must be **repeated on the promoted project** and again after the hardening migration is applied.
