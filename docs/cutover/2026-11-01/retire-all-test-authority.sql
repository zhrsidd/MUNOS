-- HUMAN ONLY, after the final synthetic check and write pause. No data is deleted.
-- This is authority retirement, not Auth session/key revocation or synthetic cleanup.
begin;
set local lock_timeout='10s';
select pg_advisory_xact_lock(6210692840397143::bigint);
do $retire$
declare ids uuid[]:=array['0331ceb6-3fa8-4731-92cb-2b4c0316d0cb'::uuid,'5d9f8e82-13dc-4f90-8fde-bed46bcb0741'::uuid,'e3a38dc2-58ca-4ef5-a962-aaab6794717e'::uuid,'a410008d-8d79-478c-9a08-341952f6af0a'::uuid,'ac63e049-b89d-40c6-88a4-f635dd6fad80'::uuid,'573cfbeb-d3ed-4cf5-b418-7d36326f69c8'::uuid,'1e6bb11f-95c2-4acc-9849-2047818cbdd4'::uuid,'bd211427-4dda-40b0-953e-651dfe5a2a57'::uuid,'ee243abf-e315-4c9c-a83f-a523b89bb42a'::uuid,'2067d8be-48cb-4b55-a139-3c8be42b4c51'::uuid];
begin
 if (public.preproduction_status()->>'projectRef') is distinct from 'kllhswucdhqqywnzxado'
 or (public.preproduction_status()->>'canTest')::boolean is distinct from true then raise exception 'Wrong target/lifecycle';end if;
 if (select count(*) from public.conferences)<>10
 or exists(select 1 from public.conferences where id<>all(ids) or coalesce((features->>'real')::boolean,false)) then raise exception 'Conference inventory changed: re-review the cleanup scope';end if;
 if exists(select 1 from public.user_access where not test_only)
 or exists(select 1 from private.access_credentials where not test_only)
 or exists(select 1 from public.submission_links where not test_only)
 or exists(select 1 from public.amendment_links where not test_only) then raise exception 'Non-test authority exists';end if;
 update public.user_access set revoked_at=now() where conference_id=any(ids) and test_only and revoked_at is null;
 update private.access_credentials set revoked_at=now() where conference_id=any(ids) and test_only and revoked_at is null;
 update public.submission_links set revoked_at=now() where conference_id=any(ids) and test_only and revoked_at is null;
 update public.amendment_links set revoked_at=now() where conference_id=any(ids) and test_only and revoked_at is null;
 if exists(select 1 from public.user_access where revoked_at is null)
 or exists(select 1 from private.access_credentials where revoked_at is null)
 or exists(select 1 from public.submission_links where revoked_at is null)
 or exists(select 1 from public.amendment_links where revoked_at is null) then raise exception 'Unrevoked authority remains';end if;
end $retire$;
select 'authority retirement verified' as result;
commit;
