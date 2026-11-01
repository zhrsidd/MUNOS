-- HUMAN ONLY after all sign-offs, cleanup, connector/credential retirement, token wait,
-- reviewed production registry source commit and removal of all test allow-lists.
begin;
select pg_advisory_xact_lock(6210692840397143::bigint);
do $guard$
begin
 if (public.preproduction_status()->>'projectRef') is distinct from 'kllhswucdhqqywnzxado'
 or (public.preproduction_status()->>'canTest')::boolean is distinct from true then raise exception 'Wrong target/lifecycle';end if;
 if exists(select 1 from public.conferences) then raise exception 'Synthetic conference cleanup not complete';end if;
end $guard$;
update private.project_lifecycle set phase='production' where singleton;
select public.preproduction_status() as lifecycle;
commit;
