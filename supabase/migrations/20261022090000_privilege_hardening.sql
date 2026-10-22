-- Privilege hardening (HD1 + narrow HD2 of docs/CONFERENCE_RELEASE_PLAN.md section 4).
-- Grants and default privileges only: no table, column, function body, policy or RLS change, no data change.
-- PROTECTED schema change. NOT applied to any hosted project; replayed only by tests until the owner separately approves
-- it and Codex reviews this exact commit (see docs/PRIVILEGE_HARDENING.md for the hosted procedure).
--
-- REVIEW NOTE FOR CODEX
-- Why: the hosted privilege audit of 2026-10-22 (docs/HOSTED_PRIVILEGE_AUDIT_2026-10-22.md) found
--   (1) `service_role` holds TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on all 36 public tables (and no SELECT/INSERT/
--       UPDATE/DELETE). `anon` and `authenticated` hold none of the four today (the foundation migration revoked them), but
--       the table default ACL for role postgres in public (anon/authenticated/service_role = Dxtm) would hand all four to
--       every table a later migration creates. PostgREST does not expose them, so this is defense in depth, not a fix for
--       a reachable bypass; direct SQL as these roles is the only way to use them.
--   (2) New postgres-owned functions are protected on hosted only because the default ACL for functions in public was
--       already stripped to {postgres=X}. Nothing in the repository enforces that, so a later DROP FUNCTION + CREATE or a
--       new overload could be silently exposed again if the platform default changed (assumption A13).
--
-- Effects (all idempotent; safe to run when the hosted state already holds):
--   HD1  alter default privileges for role postgres: functions lose EXECUTE for PUBLIC (global), and for anon,
--        authenticated, service_role in schemas public and private. A function created later is executable by its owner
--        only until a migration GRANTs it explicitly (docs/PRIVILEGE_HARDENING.md, "Convention").
--   HD2  revoke TRUNCATE, REFERENCES, TRIGGER (and MAINTAIN on PostgreSQL 17+) on every relation in schema public from
--        anon, authenticated, service_role; the same revoke as default privileges for tables created by postgres in
--        public; all privileges on sequences in public (present and default) from the same roles.
--
-- Deliberately unchanged: authenticated SELECT on every public table, every function EXECUTE grant, the service_role
-- submission path (submit_resolution, submit_amendment, amendment_link_info, submission_link_info), schema USAGE, RLS and
-- policies. supabase_admin-owned default privileges are NOT touched: postgres cannot alter another role's defaults on
-- hosted, and they only affect objects supabase_admin creates.
--
-- Side effect to know about: the global (not per-schema) default revoke of EXECUTE from PUBLIC applies to every function
-- later created by role postgres in any schema, including functions created by an extension script run as postgres.
-- No committed migration creates an extension; a future one that needs PUBLIC-callable functions must GRANT them.
--
-- Self-check: the final block aborts the whole migration (it is one transaction) if any of the three roles still holds a
-- removed privilege on any public relation afterwards, for example because it was granted by a role other than the owner.

-- Schema-local REVOKEs cannot remove global grants. Refuse unexpected global API defaults rather than widening this change.
do $defaults$
declare unexpected text;
begin
 select string_agg(format('%s %s to %s', d.defaclobjtype, a.privilege_type, coalesce(pg_get_userbyid(a.grantee), 'PUBLIC')), ', ')
 into unexpected
 from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
 where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0
   and a.grantee <> 'postgres'::regrole
   and (a.grantee = 0 or exists(select 1 from pg_roles r where r.rolname in ('anon','authenticated','service_role') and pg_has_role(r.oid, a.grantee, 'USAGE')))
   and ((d.defaclobjtype = 'f' and a.grantee <> 0)
     or (d.defaclobjtype = 'r' and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))
     or d.defaclobjtype = 'S');
 if unexpected is not null then raise exception 'privilege hardening refused: unsupported global API defaults: %', unexpected; end if;
end $defaults$;

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema private revoke execute on functions from anon, authenticated, service_role;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated, service_role;
revoke all on all sequences in schema public from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;

do $$
declare
 removed text[]:=array['TRUNCATE','REFERENCES','TRIGGER'];
 left_over text;
begin
 -- MAINTAIN exists from PostgreSQL 17. Dynamic SQL so the statement is never parsed on older servers.
 if current_setting('server_version_num')::int>=170000 then
  execute 'revoke maintain on all tables in schema public from anon, authenticated, service_role';
  execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated, service_role';
  removed:=array_append(removed,'MAINTAIN');
 end if;
 select string_agg(format('%s %s on public.%s',r.rolname,pr,c.relname),', ' order by c.relname,r.rolname,pr) into left_over
 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 cross join pg_roles r cross join unnest(removed) pr
 where c.relkind in ('r','p','v','m','f') and r.rolname in ('anon','authenticated','service_role')
   and has_table_privilege(r.oid,c.oid,pr);
 if left_over is not null then raise exception 'privilege hardening incomplete: %',left_over; end if;
 select string_agg(format('%s %s on public.%s',r.rolname,pr,c.relname),', ') into left_over
 from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
 cross join pg_roles r cross join unnest(array['USAGE','SELECT','UPDATE']) pr
 where c.relkind='S' and r.rolname in ('anon','authenticated','service_role') and has_sequence_privilege(r.oid,c.oid,pr);
 if left_over is not null then raise exception 'privilege hardening incomplete: sequence access: %',left_over; end if;
end$$;
