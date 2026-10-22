-- PREPARED, UNAPPLIED inverse of supabase/migrations/20261022090000_privilege_hardening.sql.
-- Forward-only policy: an applied migration is never edited and never rolled back by tooling. If the owner decides the
-- hardening must be undone, THIS file is copied to supabase/migrations under a NEW, later timestamp (for example
-- 2026102xxxxx_privilege_hardening_revert.sql), reviewed, replayed from empty and applied through the same human-controlled
-- release as any other migration. It lives outside supabase/migrations so no replay, test or `supabase db push` applies it.
-- tests/privilege-hardening-db.test.ts replays it after the hardening and asserts the effective privileges and default ACLs
-- return to the audited pre-hardening state.
--
-- Restores the state observed by the hosted audit of 2026-10-22 (docs/HOSTED_PRIVILEGE_AUDIT_2026-10-22.md):
--   existing public relations: service_role holds TRUNCATE, REFERENCES, TRIGGER (+ MAINTAIN on PostgreSQL 17); anon and
--     authenticated hold none of them (so they are NOT re-granted on existing relations);
--   table default ACL for role postgres in public: anon, authenticated, service_role get Dxtm on new tables;
--   functions: select the global PUBLIC default from the saved before-capture; its absence was NOT established by the audit.
--     The hosted per-schema function default {postgres=X} is unchanged by the hardening, so nothing to restore there.
-- It does not recreate anything the hardening never removed (sequence privileges did not exist before).
-- NOTE: this reopens the same exposure the hardening closed. Reverting is a deliberate owner decision, not a rollback of a failure.
-- A human must select this from the saved BEFORE capture when preparing the new migration. No default is safe.
-- SET LOCAL munos_hardening_revert.global_public_execute = 'granted' (or 'revoked') in the SAME transaction.
do $baseline$
begin
 if coalesce(current_setting('munos_hardening_revert.global_public_execute',true),'') not in ('granted','revoked') then
  raise exception 'revert refused: select granted/revoked global_public_execute from the saved pre-hardening default ACL capture';
 end if;
end $baseline$;
grant truncate, references, trigger on all tables in schema public to service_role;
alter default privileges for role postgres in schema public grant truncate, references, trigger on tables to anon, authenticated, service_role;
do $global$
begin
 if current_setting('munos_hardening_revert.global_public_execute') = 'granted' then
  alter default privileges for role postgres grant execute on functions to public;
 else
  alter default privileges for role postgres revoke execute on functions from public;
 end if;
end $global$;
do $$begin
 if current_setting('server_version_num')::int>=170000 then
  execute 'grant maintain on all tables in schema public to service_role';
  execute 'alter default privileges for role postgres in schema public grant maintain on tables to anon, authenticated, service_role';
 end if;
end$$;
