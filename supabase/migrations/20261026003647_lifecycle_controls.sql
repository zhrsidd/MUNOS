-- Minimal lifecycle controls for the owner-approved direct RPC conference path.
-- No gateway, signed attestation or administrative tamper-resistance is claimed.
-- New objects have no API privileges except the narrowly granted status metadata RPC below.
create table private.project_lifecycle (
 singleton boolean primary key default true check(singleton),
 project_ref text not null check(project_ref ~ '^[a-z0-9]{20}$'),
 phase text not null check(phase in ('preproduction','rehearsal','production')),
 revision bigint not null default 1,
 changed_at timestamptz not null default now()
);
alter table private.project_lifecycle enable row level security;
revoke all on private.project_lifecycle from public,anon,authenticated,service_role;
insert into private.project_lifecycle(project_ref,phase) values('kllhswucdhqqywnzxado','preproduction');

create function private.lifecycle_allows(test_only boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select case phase when 'production' then not test_only
  when 'preproduction' then test_only when 'rehearsal' then test_only else false end
  from private.project_lifecycle where singleton),false);
$$;
revoke all on function private.lifecycle_allows(boolean) from public,anon,authenticated,service_role;
grant execute on function private.lifecycle_allows(boolean) to authenticated;

-- Every new authority or submission acquires this BEFORE mutation/committee/credential locks.
-- Promotion takes the exclusive form. Reads need no advisory lock.
create function private.lock_lifecycle() returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(6210692840397143::bigint);
 if not exists(select 1 from private.project_lifecycle where singleton) then
  raise exception 'Lifecycle unavailable' using errcode='42501';
 end if;
end $$;
revoke all on function private.lock_lifecycle() from public,anon,authenticated,service_role;

create function private.lifecycle_new_test_only() returns boolean
language plpgsql security definer set search_path='' as $$
declare p text;
begin
 perform private.lock_lifecycle();
 select phase into p from private.project_lifecycle where singleton;
 if p is null or p not in ('preproduction','rehearsal','production') then
  raise exception 'Lifecycle unavailable' using errcode='42501';
 end if;
 return p <> 'production';
end $$;
revoke all on function private.lifecycle_new_test_only() from public,anon,authenticated,service_role;

-- All existing access and QR links were created in synthetic preproduction.
alter table private.access_credentials add column test_only boolean not null default true;
alter table public.user_access add column test_only boolean not null default true;
alter table public.submission_links add column test_only boolean not null default true;
alter table public.amendment_links add column test_only boolean not null default true;
alter table private.access_credentials alter column test_only set default private.lifecycle_new_test_only();
alter table public.user_access alter column test_only set default private.lifecycle_new_test_only();
alter table public.submission_links alter column test_only set default private.lifecycle_new_test_only();
alter table public.amendment_links alter column test_only set default private.lifecycle_new_test_only();

-- Only the database owner/human cutover operator can update this table. Normal API/test roles cannot
-- change, delete or truncate it. An owner/superuser can deliberately override triggers: this is not
-- a defence against administrative access, which must be retired separately at promotion.
create function private.guard_lifecycle_transition() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(6210692840397143::bigint);
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Lifecycle removal refused' using errcode='42501'; end if;
 if new.project_ref is distinct from old.project_ref then raise exception 'Lifecycle ref change refused' using errcode='42501'; end if;
 if old.phase='production' and new.phase is distinct from old.phase then
  raise exception 'Production demotion refused' using errcode='42501';
 end if;
 if new.phase='production' and old.phase<>'production' then
  if exists(select 1 from public.user_access where test_only and revoked_at is null)
   or exists(select 1 from private.access_credentials where test_only and revoked_at is null)
   or exists(select 1 from public.submission_links where test_only and revoked_at is null)
   or exists(select 1 from public.amendment_links where test_only and revoked_at is null) then
   raise exception 'Revoke all test grants, codes and links before promotion' using errcode='42501';
  end if;
 end if;
 new.revision:=old.revision+1; new.changed_at:=clock_timestamp();
 return new;
end $$;
revoke all on function private.guard_lifecycle_transition() from public,anon,authenticated,service_role;
create trigger guard_lifecycle_transition before update or delete on private.project_lifecycle
 for each row execute function private.guard_lifecycle_transition();
create trigger guard_lifecycle_truncate before truncate on private.project_lifecycle
 for each statement execute function private.guard_lifecycle_transition();

-- Fixed, non-sensitive phase metadata, available before anonymous Auth signup. No conference,
-- person, key, grant or submission data. This is the ONLY anon function-execute policy exception.
create function public.preproduction_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('projectRef',project_ref,'phase',phase,'revision',revision,
  'canTest',phase in ('preproduction','rehearsal')) from private.project_lifecycle where singleton),
  jsonb_build_object('projectRef',null,'phase','unknown','revision',null,'canTest',false));
$$;
revoke all on function public.preproduction_status() from public,anon,authenticated,service_role;
grant execute on function public.preproduction_status() to anon,authenticated;

create or replace function private.has_access(conf uuid, committee uuid, roles public.conference_role[]) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
 select 1 from public.user_access a where a.user_id=(select auth.uid()) and a.conference_id=conf
 and a.revoked_at is null and a.expires_at>now() and a.role=any(roles)
 and private.lifecycle_allows(a.test_only)
 and (a.committee_id is null or a.committee_id=committee));
$$;
create or replace function private.access_grants() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('conference_id',conference_id,'committee_id',committee_id,'role',role)),'[]')
 from public.user_access where user_id=(select auth.uid()) and (select auth.uid()) is not null
 and revoked_at is null and expires_at>now() and private.lifecycle_allows(test_only);
$$;
alter policy read_authorized on public.user_access using (
 user_id=(select auth.uid()) and revoked_at is null and expires_at>now() and private.lifecycle_allows(test_only));
alter policy read_authorized on public.submission_links using (
 private.lifecycle_allows(test_only) and private.has_access(conference_id,committee_id,array['admin','chair']::public.conference_role[]));
alter policy read_authorized on public.amendment_links using (
 private.lifecycle_allows(test_only) and private.has_access(conference_id,committee_id,array['admin','chair']::public.conference_role[]));

-- Preserve every existing mutation, receipt and public-submission contract. Anchors must match
-- exactly once; replay refuses a changed base instead of silently applying a partial patch.
create or replace function pg_temp.lifecycle_patch_once(definition text,anchor text,replacement text,label text) returns text
language plpgsql as $$
begin
 if (length(definition)-length(replace(definition,anchor,'')))<>length(anchor) then
  raise exception '% changed; review lifecycle patch',label;
 end if;
 return replace(definition,anchor,replacement);
end $$;
do $patch$
declare definition text; signature text; anchor text;
begin
 -- Includes direct private SQL calls as well as public wrappers. Receipt lookup and exact payload
 -- validation still precede permission for a NEW write. An accepted retry creates no effect.
 foreach signature in array array[
  'private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
  'private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
  'private.apply_staff_batch(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
  'private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz)',
  'public.redeem_access_code(uuid,text)',
  'public.rotate_access_code(uuid,public.conference_role,uuid,timestamptz)',
  'public.revoke_access_code(uuid,uuid,boolean)',
  'public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer)',
  'public.submit_amendment(text,uuid,uuid,uuid,text,text,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  -- Insert at the first body BEGIN. pg_get_functiondef keeps the source's lower-case body.
  anchor:=substring(definition from '(begin[[:space:]]+[^[:space:]]+)');
  if anchor is null then raise exception 'Missing body in %',signature; end if;
  definition:=pg_temp.lifecycle_patch_once(definition,anchor,
   replace(anchor,'begin','begin'||chr(10)||' perform private.lock_lifecycle();'),signature);
  if signature like 'public.redeem_access_code(%' then
   definition:=pg_temp.lifecycle_patch_once(definition,'if credential.id is null then',
    'if credential.id is null or not private.lifecycle_allows(credential.test_only) then','redeem purpose');
   definition:=pg_temp.lifecycle_patch_once(definition,
    'insert into public.user_access(conference_id,user_id,role,committee_id,expires_at,revoked_at)',
    'insert into public.user_access(conference_id,user_id,role,committee_id,expires_at,revoked_at,test_only)','grant class columns');
   definition:=pg_temp.lifecycle_patch_once(definition,
    'values(conf,actor,credential.role,credential.committee_id,credential.expires_at,null)',
    'values(conf,actor,credential.role,credential.committee_id,credential.expires_at,null,credential.test_only)','grant class values');
   definition:=pg_temp.lifecycle_patch_once(definition,'expires_at = excluded.expires_at,',
    'expires_at = excluded.expires_at, test_only = excluded.test_only,','grant class update');
  elsif signature like 'public.submit_resolution(%' then
   definition:=pg_temp.lifecycle_patch_once(definition,'token = link_token and revoked_at is null',
    'token = link_token and revoked_at is null and private.lifecycle_allows(test_only)','resolution link purpose');
   definition:=pg_temp.lifecycle_patch_once(definition,'id=link.id and revoked_at is null',
    'id=link.id and revoked_at is null and private.lifecycle_allows(test_only)','resolution locked link');
  elsif signature like 'public.submit_amendment(%' then
   if (length(definition)-length(replace(definition,'token=link_token and revoked_at is null',''))) <> 2*length('token=link_token and revoked_at is null') then raise exception 'Amendment link lookup changed; review lifecycle patch'; end if;
   definition:=replace(definition,'token=link_token and revoked_at is null',
    'token=link_token and revoked_at is null and private.lifecycle_allows(test_only)');
  end if;
  execute definition;
 end loop;
 foreach signature in array array['public.submission_link_info(text)','public.amendment_link_info(text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  definition:=pg_temp.lifecycle_patch_once(definition,'l.token=link_token and l.revoked_at is null',
   'l.token=link_token and l.revoked_at is null and private.lifecycle_allows(l.test_only)',signature);
  execute definition;
 end loop;
end $patch$;
