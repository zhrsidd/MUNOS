-- Cache the caller's grants once per SELECT statement, rather than querying
-- user_access for every candidate row and every nested document-version policy.
create function private.access_grants() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('conference_id',conference_id,'committee_id',committee_id,'role',role)),'[]')
 from public.user_access where user_id=(select auth.uid()) and (select auth.uid()) is not null and revoked_at is null and expires_at>now();
$$;
revoke all on function private.access_grants() from public,anon;
grant execute on function private.access_grants() to authenticated;
create function private.permitted(grants jsonb,conf uuid,committee uuid,roles public.conference_role[]) returns boolean
language sql immutable security invoker set search_path='' as $$
 select exists(select 1 from unnest(roles) r where
 grants @> jsonb_build_array(jsonb_build_object('conference_id',conf,'committee_id',null,'role',r))
 or (committee is not null and grants @> jsonb_build_array(jsonb_build_object('conference_id',conf,'committee_id',committee,'role',r))));
$$;
revoke all on function private.permitted(jsonb,uuid,uuid,public.conference_role[]) from public,anon;
grant execute on function private.permitted(jsonb,uuid,uuid,public.conference_role[]) to authenticated;
do $$ declare policy record; begin
 for policy in select tablename,policyname,qual from pg_policies where schemaname='public' and qual like '%private.has_access(%' loop
 execute format('alter policy %I on public.%I using (%s)',policy.policyname,policy.tablename,replace(policy.qual,'private.has_access(', 'private.permitted((select private.access_grants()),'));
 end loop;
end $$;
