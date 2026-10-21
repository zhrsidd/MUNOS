-- The bootstrap the repository's existing PostgreSQL 17 tests use (tests/helpers/postgres.ts): three plain roles, no
-- default privileges, no authenticator, no Storage. Used only to show how much of the inventory depends on the
-- hosted default-privilege model.
do $$begin
 if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
grant usage on schema public to anon,authenticated,service_role;
