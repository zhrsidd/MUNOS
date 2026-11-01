-- HUMAN ONLY. After promotion, final release sign-off and permission for real data.
-- Reserved UUID matches production.env.example. Review metadata before executing.
begin;
select pg_advisory_xact_lock(6210692840397143::bigint);
do $guard$
begin
 if (public.preproduction_status()->>'projectRef') is distinct from 'kllhswucdhqqywnzxado'
 or (public.preproduction_status()->>'phase') is distinct from 'production' then
  raise exception 'Real conference creation requires the intended production project';
 end if;
 if exists(select 1 from public.conferences) then raise exception 'Expected empty initial production conference set; inspect before proceeding';end if;
end $guard$;
insert into public.conferences(id,name,venue,date,features)
values ('586db0d4-dde5-40a1-a50e-f925fce7e70a','DCMUN 2026','Doha College','2026-11-05','{"real":true}'::jsonb);
select id,name,date,features from public.conferences where id='586db0d4-dde5-40a1-a50e-f925fce7e70a';
commit;
