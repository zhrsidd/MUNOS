-- HUMAN ONLY: a single known legacy TEST conference has a name not accepted by cleanup's reviewed prefixes.
-- Review this exact UUID/name. This does not relax the cleanup tool or delete anything.
begin;
select pg_advisory_xact_lock(6210692840397143::bigint);
do $guard$
begin
 if (public.preproduction_status()->>'projectRef') is distinct from 'kllhswucdhqqywnzxado'
 or (public.preproduction_status()->>'canTest')::boolean is distinct from true then raise exception 'Wrong target/lifecycle';end if;
 if not exists(select 1 from public.conferences where id='e3a38dc2-58ca-4ef5-a962-aaab6794717e'
 and name in('TEST Offline Rehearsal (temporary)','SYNTHETIC · TEST Offline Rehearsal (temporary)')
 and coalesce((features->>'real')::boolean,false)=false) then raise exception 'Legacy fixture identity changed';end if;
 if exists(select 1 from public.user_access where conference_id='e3a38dc2-58ca-4ef5-a962-aaab6794717e' and revoked_at is null)
 or exists(select 1 from private.access_credentials where conference_id='e3a38dc2-58ca-4ef5-a962-aaab6794717e' and revoked_at is null) then raise exception 'Retire access first';end if;
end $guard$;
update public.conferences set name='SYNTHETIC · TEST Offline Rehearsal (temporary)'
 where id='e3a38dc2-58ca-4ef5-a962-aaab6794717e' and name='TEST Offline Rehearsal (temporary)';
commit;
