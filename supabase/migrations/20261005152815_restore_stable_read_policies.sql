-- Restore the previously verified authorization evaluation after the experimental
-- cached-grant policies did not pass a second sustained burst/load run.
do $$ declare policy record; begin
 for policy in select tablename,policyname,qual from pg_policies where schemaname='public' and qual like '%private.permitted(%' loop
 execute format('alter policy %I on public.%I using (%s)',policy.policyname,policy.tablename,
 regexp_replace(policy.qual,'private\.permitted\(\( SELECT private\.access_grants\(\) AS access_grants\),', 'private.has_access(', 'g'));
 end loop;
end $$;
