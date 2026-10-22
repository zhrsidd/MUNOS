-- MODEL of a hosted Supabase project's role/schema/default-privilege baseline, for DISPOSABLE LOCAL PostgreSQL only.
-- Roles and schemas are reconstructed from Supabase's documented behaviour and from the roles/grants the repository's own
-- tests assume; the DEFAULT PRIVILEGES at the end were corrected on 2026-10-22 to match the hosted privilege audit (an
-- earlier version modelled `ALL` for the API roles, which the hosted project does not have). It is still NOT an
-- observation of the hosted project beyond what the audit read (see the audit's "does not cover" list). Anything that
-- depends on it is "verified against the model", never "verified on hosted".
--
-- Run as the local superuser `postgres` (the migration owner). On hosted Supabase `postgres` is not a superuser; that
-- difference is listed in docs/ISOLATION_FEASIBILITY.md.
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
 if not exists(select from pg_roles where rolname='authenticator') then create role authenticator login noinherit nocreatedb nocreaterole nosuperuser; end if;
 if not exists(select from pg_roles where rolname='supabase_admin') then create role supabase_admin login superuser; end if;
end$$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create schema auth;
create table auth.users(id uuid primary key);
-- The real definitions (Supabase auth schema): both the legacy per-claim GUC and the JSON claims GUC are honoured.
create function auth.uid() returns uuid language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                 (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
create function auth.jwt() returns jsonb language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                 nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

-- Minimal Storage stand-in so the Storage policies in the migrations are replayed instead of skipped.
create schema storage;
create table storage.buckets(id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on all tables in schema storage to service_role;
grant select on storage.objects to anon, authenticated;

-- Default privileges, CALIBRATED to the hosted read-only audit of 2026-10-22 (docs/HOSTED_PRIVILEGE_AUDIT_2026-10-22.md;
-- DCMUN Staging, PostgreSQL 17.11, before migration 20261022090000_privilege_hardening). pg_default_acl as observed for
-- role postgres in schema public:
--   tables     {postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}   (no SELECT/INSERT/UPDATE/DELETE)
--   sequences  {postgres=rwU}                                                           (nothing for the API roles)
--   functions  {postgres=X}                                                             (nothing for the API roles)
-- Not observed and therefore not modelled: a global (all-schema) default for role postgres, so PostgreSQL's own default
-- (EXECUTE to PUBLIC on new functions) applies here. supabase_admin's defaults (arwdDxtm/rwU/X to the API roles in public)
-- only affect objects supabase_admin creates; the migrations never do, so they are omitted.
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select, update on sequences to postgres;
alter default privileges for role postgres in schema public grant execute on functions to postgres;
