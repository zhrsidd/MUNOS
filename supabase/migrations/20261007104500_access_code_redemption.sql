-- Staff access codes redeem into the existing user_access authorization model.
-- Raw codes are generated in the database, returned once, and never stored.
-- Code-management RPCs are intentionally separate from apply_conference_mutation because
-- that general mutation path audits the full command JSON.

alter table private.access_credentials
  add column created_by uuid references auth.users(id),
  add column updated_at timestamptz not null default now();

alter table private.access_credentials
  add constraint access_credentials_chair_scope
  check (role <> 'chair' or committee_id is not null),
  add constraint access_credentials_digest_shape
  check (credential_hash ~ '^[0-9a-f]{64}$');

create unique index access_credentials_digest_unique
  on private.access_credentials(credential_hash);
-- NULL committee is one real conference-wide scope, including expired but unrevoked codes.
create unique index access_credentials_one_active_scope
  on private.access_credentials(conference_id, role, committee_id) nulls not distinct
  where revoked_at is null;
create index access_credentials_scope_lookup
  on private.access_credentials(conference_id, role, committee_id, created_at desc);
create index access_credentials_active_expiry
  on private.access_credentials(conference_id, expires_at)
  where revoked_at is null;

-- Tracks which credential authorized a grant without exposing credential ids through
-- public.user_access. This allows an Executive to explicitly revoke devices for a
-- compromised code while routine rotation may leave prepared devices signed in.
create table private.access_grant_sources (
  user_access_id uuid primary key references public.user_access(id) on delete cascade,
  credential_id uuid not null references private.access_credentials(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table private.access_grant_sources enable row level security;
revoke all on private.access_grant_sources from public, anon, authenticated;
create policy no_browser_access on private.access_grant_sources
  for all to anon, authenticated using(false) with check(false);
create index access_grant_sources_credential_idx
  on private.access_grant_sources(credential_id);

-- Per-auth-user throttling protects against accidental/repeated guessing. The credentials
-- themselves carry high-entropy system-generated secrets, so recreating anonymous identities
-- does not make brute force practical.
create table private.access_redemption_attempts (
  id bigint generated always as identity primary key,
  conference_id uuid not null references public.conferences(id),
  user_id uuid not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
alter table private.access_redemption_attempts enable row level security;
revoke all on private.access_redemption_attempts from public, anon, authenticated;
create policy no_browser_access on private.access_redemption_attempts
  for all to anon, authenticated using(false) with check(false);
create index access_redemption_attempts_user_window
  on private.access_redemption_attempts(user_id, conference_id, created_at desc);
create index access_redemption_attempts_created_idx
  on private.access_redemption_attempts(created_at);

-- An authenticated device with no grant can exchange a valid high-entropy code for exactly
-- the role/scope stored on the credential. Anonymous Supabase Auth identities use the
-- authenticated Postgres role; without this RPC they still have no conference access.
create function public.redeem_access_code(conf uuid, code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  normalized text;
  digest text;
  credential private.access_credentials;
  committee_scope uuid;
  grant_id uuid;
  recent_failures integer;
begin
  if actor is null then
    raise exception 'Session required' using errcode='42501';
  end if;

  select count(*) into recent_failures
  from private.access_redemption_attempts a
  where a.user_id = actor
    and a.conference_id = conf
    and not a.success
    and a.created_at > now() - interval '10 minutes';

  if recent_failures >= 8 then
    return jsonb_build_object('status','rate_limited');
  end if;

  if not exists(select 1 from public.conferences c where c.id = conf) then
    return jsonb_build_object('status','invalid');
  end if;

  if length(coalesce(code,'')) > 80 then
    normalized := '';
  else
    normalized := upper(regexp_replace(coalesce(code,''),'[[:space:]-]','','g'));
  end if;

  if normalized ~ '^[0-9A-F]{24}$' then
    digest := encode(sha256(convert_to(normalized,'UTF8')),'hex');
    -- Match rotation/lifecycle lock order. The grant's committee FK also needs
    -- KEY SHARE, so acquire it before locking the credential, not during insert.
    -- This first lookup is only a scope hint; the locked lookup below revalidates.
    select a.committee_id into committee_scope
    from private.access_credentials a
    where a.conference_id = conf and a.credential_hash = digest
      and a.revoked_at is null and a.expires_at > now();
    if committee_scope is not null then
      perform 1 from public.committees c
      where c.id = committee_scope and c.conference_id = conf for key share;
    end if;
    select a.* into credential
    from private.access_credentials a
    where a.conference_id = conf
      and a.credential_hash = digest
      and a.revoked_at is null
      and a.expires_at > now()
    limit 1 for update;
    -- Held until commit: concurrent revoke/rotate either precedes this lookup
    -- (the revoked predicate is rechecked) or waits until its grant/source exists.
  end if;

  if credential.id is null then
    insert into private.access_redemption_attempts(conference_id,user_id,success)
    values(conf,actor,false);
    return jsonb_build_object('status','invalid');
  end if;

  insert into public.user_access(conference_id,user_id,role,committee_id,expires_at,revoked_at)
  values(conf,actor,credential.role,credential.committee_id,credential.expires_at,null)
  on conflict (user_id,conference_id,role,committee_id)
  do update set
    expires_at = excluded.expires_at,
    revoked_at = null,
    updated_at = now()
  returning id into grant_id;

  insert into private.access_grant_sources(user_access_id,credential_id)
  values(grant_id,credential.id)
  on conflict(user_access_id) do update
    set credential_id = excluded.credential_id, updated_at = now();

  insert into private.access_redemption_attempts(conference_id,user_id,success)
  values(conf,actor,true);

  return jsonb_build_object(
    'status', 'ok',
    'role', credential.role,
    'committeeId', credential.committee_id,
    'expiresAt', credential.expires_at
  );
end; $$;
revoke all on function public.redeem_access_code(uuid,text) from public, anon;
grant execute on function public.redeem_access_code(uuid,text) to authenticated;

-- Executive-only metadata. Raw codes and digests are deliberately omitted.
create function public.access_code_status(conf uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not private.has_access(
    conf, null, array['admin']::public.conference_role[]
  ) then
    raise exception 'Executive access required' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'role', x.role,
      'committeeId', x.committee_id,
      'committeeCode', c.code,
      'committeeName', c.name,
      'createdAt', x.created_at,
      'expiresAt', x.expires_at,
      'revokedAt', x.revoked_at,
      'active', (x.revoked_at is null and x.expires_at > now())
    )
    order by x.role::text, c.code nulls first
  ), '[]'::jsonb)
  into result
  from (
    select distinct on (a.role,a.committee_id)
      a.id,a.role,a.committee_id,a.created_at,a.expires_at,a.revoked_at
    from private.access_credentials a
    where a.conference_id = conf
    order by a.role,a.committee_id,a.created_at desc,a.id desc
  ) x
  left join public.committees c
    on c.id = x.committee_id and c.conference_id = conf;

  return result;
end; $$;
revoke all on function public.access_code_status(uuid) from public, anon;
grant execute on function public.access_code_status(uuid) to authenticated;

-- Rotating a code prevents future redemption of the previous code but intentionally leaves
-- already-prepared devices active. Use revoke_access_code(..., true) for a compromised code
-- when those existing grants must also be revoked.
create function public.rotate_access_code(
  conf uuid,
  requested_role public.conference_role,
  committee uuid,
  expires_at timestamptz
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  raw text;
  formatted text;
  digest text;
  credential_id uuid := gen_random_uuid();
  audit_mutation uuid := gen_random_uuid();
begin
  if actor is null or not private.has_access(
    conf, null, array['admin']::public.conference_role[]
  ) then
    raise exception 'Executive access required' using errcode='42501';
  end if;

  if requested_role not in ('chair','approval','logistics','admin') then
    raise exception 'Unsupported access-code role' using errcode='22023';
  end if;
  if requested_role = 'chair' then
    if committee is null or not exists(
      select 1 from public.committees c where c.id = committee and c.conference_id = conf for update
    ) then
      raise exception 'Choose a valid committee' using errcode='22023';
    end if;
  elsif committee is not null then
    raise exception 'Only Chair codes are committee-scoped' using errcode='22023';
  end if;
  if expires_at is null or expires_at <= now() then
    raise exception 'Access-code expiry must be in the future' using errcode='22023';
  end if;

  -- Serialize even the first rotation, when there is no credential row to lock.
  -- Committee row (for Chair scopes) precedes this lock, matching lifecycle operations.
  perform pg_advisory_xact_lock(hashtextextended(
    'access-code:'||conf::text||':'||requested_role::text||':'||coalesce(committee::text,'conference'),0));

  update private.access_credentials a
    set revoked_at = coalesce(a.revoked_at,now()), updated_at = now()
  where a.conference_id = conf
    and a.role = requested_role
    and a.committee_id is not distinct from committee
    and a.revoked_at is null;

  -- 24 hex characters. gen_random_uuid is already used by the core schema; after removing
  -- separators this provides a high-entropy, copyable secret without an extension dependency.
  raw := upper(substr(replace(gen_random_uuid()::text,'-',''),1,24));
  formatted :=
    substr(raw,1,4)||'-'||substr(raw,5,4)||'-'||substr(raw,9,4)||'-'||
    substr(raw,13,4)||'-'||substr(raw,17,4)||'-'||substr(raw,21,4);
  digest := encode(sha256(convert_to(raw,'UTF8')),'hex');

  insert into private.access_credentials(
    id,conference_id,committee_id,role,credential_hash,expires_at,created_by
  ) values(
    credential_id,conf,committee,requested_role,digest,expires_at,actor
  );

  insert into public.audit_log(
    conference_id,committee_id,"actorId",action,"entityId",mutation_id,details
  ) values(
    conf,committee,actor,'Access code rotated',credential_id,audit_mutation,
    jsonb_build_object(
      'role',requested_role,
      'committeeId',committee,
      'expiresAt',expires_at
    )
  );

  return jsonb_build_object(
    'id', credential_id,
    'role', requested_role,
    'committeeId', committee,
    'expiresAt', expires_at,
    'code', formatted
  );
end; $$;
revoke all on function public.rotate_access_code(uuid,public.conference_role,uuid,timestamptz) from public, anon;
grant execute on function public.rotate_access_code(uuid,public.conference_role,uuid,timestamptz) to authenticated;

create function public.revoke_access_code(
  conf uuid,
  credential uuid,
  revoke_devices boolean default false
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid();
  rec private.access_credentials;
  committee_scope uuid;
  revoked_devices integer := 0;
  audit_mutation uuid := gen_random_uuid();
begin
  if actor is null or not private.has_access(
    conf, null, array['admin']::public.conference_role[]
  ) then
    raise exception 'Executive access required' using errcode='42501';
  end if;

  -- The audit row also references committee: preserve the same committee-first
  -- lock order as rotation/redemption and re-read the credential under its lock.
  select a.committee_id into committee_scope
  from private.access_credentials a where a.id = credential and a.conference_id = conf;
  if committee_scope is not null then
    perform 1 from public.committees c
    where c.id = committee_scope and c.conference_id = conf for key share;
  end if;

  select a.* into rec
  from private.access_credentials a
  where a.id = credential and a.conference_id = conf
  for update; -- Same credential lock as redemption, before examining grant sources.

  if rec.id is null then
    raise exception 'Access code unavailable' using errcode='22023';
  end if;

  update private.access_credentials
    set revoked_at = coalesce(revoked_at,now()), updated_at = now()
  where id = rec.id;

  if revoke_devices then
    update public.user_access ua
      set revoked_at = coalesce(ua.revoked_at,now()), updated_at = now()
    from private.access_grant_sources s
    where s.credential_id = rec.id
      and s.user_access_id = ua.id
      and ua.conference_id = conf
      and ua.revoked_at is null;
    get diagnostics revoked_devices = row_count;
  end if;

  insert into public.audit_log(
    conference_id,committee_id,"actorId",action,"entityId",mutation_id,details
  ) values(
    conf,rec.committee_id,actor,'Access code revoked',rec.id,audit_mutation,
    jsonb_build_object(
      'role',rec.role,
      'committeeId',rec.committee_id,
      'revokeDevices',revoke_devices,
      'revokedDevices',revoked_devices
    )
  );

  return jsonb_build_object('revokedDevices',revoked_devices);
end; $$;
revoke all on function public.revoke_access_code(uuid,uuid,boolean) from public, anon;
grant execute on function public.revoke_access_code(uuid,uuid,boolean) to authenticated;
