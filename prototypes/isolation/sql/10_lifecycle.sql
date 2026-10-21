-- PROTOTYPE, NOT SHIPPING, NOT A MIGRATION. Applied only to a disposable local PostgreSQL 17 database by
-- prototypes/isolation/harness.ts, after every committed migration has been replayed. It never touches supabase/migrations.
-- Mirrors docs/ISOLATION_DESIGN.md section 5 (lifecycle marker, transition log, key ring, token floor, proof use log).
-- Names are illustrative; nothing here is an approved design decision.

do $$begin
 if not exists(select from pg_roles where rolname='lifecycle_owner') then create role lifecycle_owner nologin; end if;     -- owns lifecycle objects
 if not exists(select from pg_roles where rolname='lifecycle_operator') then create role lifecycle_operator nologin; end if; -- the human-held role (login wrapper omitted)
 if not exists(select from pg_roles where rolname='gw_owner') then create role gw_owner nologin; end if;                     -- owns the gateway wrapper functions
 if not exists(select from pg_roles where rolname='proto_agent') then create role proto_agent nologin; end if;               -- a custom "test/agent" role
 if not exists(select from pg_roles where rolname='proto_nobody') then create role proto_nobody nologin; end if;             -- a role with no grants at all (PUBLIC only)
end$$;
grant authenticated to proto_agent;      -- an agent role that inherits what the API role can do
create extension if not exists pgcrypto with schema extensions;

create schema lifecycle authorization lifecycle_owner;
revoke all on schema lifecycle from public;
-- The owner of the lifecycle objects needs the platform helpers it calls from definer functions.
grant usage on schema auth, extensions to lifecycle_owner;
grant execute on function auth.uid(), auth.jwt() to lifecycle_owner;

create table lifecycle.project_state(
 id boolean primary key default true check (id),
 phase text not null check (phase in ('preproduction','synthetic_locked','production')),
 epoch bigint not null,
 project_ref text not null,
 token_floor bigint not null default 0,
 register_seq bigint not null default 0,
 real_data_attested boolean not null default false,
 changed_at timestamptz not null, changed_by text not null, evidence_digest text not null);
alter table lifecycle.project_state owner to lifecycle_owner;

create table lifecycle.transitions(
 seq bigserial primary key, kind text not null check (kind in ('init','transition','token_floor','key')),
 from_phase text, to_phase text not null, epoch bigint not null, register_seq bigint, operator text not null,
 evidence_digest text, freeze_last_issued_at timestamptz, barrier_at timestamptz, detail text,
 at timestamptz not null default clock_timestamp(), prev_digest text not null, digest text not null);
alter table lifecycle.transitions owner to lifecycle_owner;
alter sequence lifecycle.transitions_seq_seq owner to lifecycle_owner;

create table lifecycle.gateway_keys(
 kid text primary key, class text not null check (class in ('test','evidence','production')), secret bytea not null,
 status text not null check (status in ('staged','active','revoked')), not_before timestamptz, not_after timestamptz,
 created_at timestamptz not null default now());
alter table lifecycle.gateway_keys owner to lifecycle_owner;

create table lifecycle.proof_uses(jti text primary key, fn text not null, used_at timestamptz not null default clock_timestamp(), exp timestamptz not null);
alter table lifecycle.proof_uses owner to lifecycle_owner;

revoke all on all tables in schema lifecycle from public;
revoke all on all sequences in schema lifecycle from public;

-- Append-only log: no UPDATE, DELETE or TRUNCATE, even for the table owner. (A superuser can drop the trigger: section 2.3.)
create function lifecycle.refuse_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'lifecycle log is append-only' using errcode='GW090'; end $$;
create trigger transitions_append_only before update or delete on lifecycle.transitions for each row execute function lifecycle.refuse_change();
create trigger transitions_no_truncate before truncate on lifecycle.transitions for each statement execute function lifecycle.refuse_change();
alter function lifecycle.refuse_change() owner to lifecycle_owner;

-- The marker may only change inside lifecycle functions (they set a transaction-local flag). A direct UPDATE or DELETE,
-- even by the table owner, is refused.
create function lifecycle.guard_marker() returns trigger language plpgsql set search_path='' as $$
begin
 if coalesce(current_setting('lifecycle.in_function',true),'')<>'1' then raise exception 'lifecycle marker changes only through lifecycle functions' using errcode='GW091'; end if;
 if tg_op='DELETE' then raise exception 'lifecycle marker cannot be deleted' using errcode='GW091'; end if;
 return new;
end $$;
create trigger project_state_guard before update or delete on lifecycle.project_state for each row execute function lifecycle.guard_marker();
create trigger project_state_no_truncate before truncate on lifecycle.project_state for each statement execute function lifecycle.refuse_change();
alter function lifecycle.guard_marker() owner to lifecycle_owner;

create function lifecycle.chain(prev text, parts text[]) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(coalesce(prev,'')||'|'||array_to_string(parts,'|','~'),'UTF8'),'sha256'),'hex') $$;
alter function lifecycle.chain(text,text[]) owner to lifecycle_owner;

create function lifecycle.log(kind text, from_phase text, to_phase text, epoch bigint, register_seq bigint, evidence text, freeze_at timestamptz, barrier timestamptz, detail text)
returns void language plpgsql security definer set search_path='' as $$
declare prev text; op text:=session_user::text;
begin
 select digest into prev from lifecycle.transitions order by seq desc limit 1;
 insert into lifecycle.transitions(kind,from_phase,to_phase,epoch,register_seq,operator,evidence_digest,freeze_last_issued_at,barrier_at,detail,prev_digest,digest)
 values(kind,from_phase,to_phase,epoch,register_seq,op,evidence,freeze_at,barrier,detail,coalesce(prev,''),
  lifecycle.chain(prev,array[kind,from_phase,to_phase,epoch::text,register_seq::text,op,evidence,freeze_at::text,barrier::text,detail]));
end $$;
alter function lifecycle.log(text,text,text,bigint,bigint,text,timestamptz,timestamptz,text) owner to lifecycle_owner;

-- Recompute the chain; true when the log is internally consistent. A register would also store the head digest (section 5.5).
create function lifecycle.verify_chain() returns boolean language plpgsql security definer set search_path='' as $$
declare r record; prev text:=''; ok boolean:=true;
begin
 for r in select * from lifecycle.transitions order by seq loop
  if r.prev_digest<>prev or r.digest<>lifecycle.chain(nullif(prev,''),array[r.kind,r.from_phase,r.to_phase,r.epoch::text,r.register_seq::text,r.operator,r.evidence_digest,r.freeze_last_issued_at::text,r.barrier_at::text,r.detail]) then ok:=false; end if;
  prev:=r.digest;
 end loop;
 return ok;
end $$;
alter function lifecycle.verify_chain() owner to lifecycle_owner;

create function lifecycle.init(ref text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('lifecycle.in_function','1',true);
 insert into lifecycle.project_state(phase,epoch,project_ref,changed_at,changed_by,evidence_digest) values('preproduction',1,ref,clock_timestamp(),session_user::text,'init');
 perform lifecycle.log('init',null,'preproduction',1,0,'init',null,null,ref);
end $$;
alter function lifecycle.init(text) owner to lifecycle_owner;

create function lifecycle.add_key(p_kid text, p_class text, p_secret bytea) returns void language plpgsql security definer set search_path='' as $$
declare s lifecycle.project_state;
begin
 select * into s from lifecycle.project_state;
 if p_class='test' and s.phase<>'preproduction' then raise exception 'test keys exist only in preproduction' using errcode='GW011'; end if;
 if p_class='evidence' and s.phase<>'synthetic_locked' then raise exception 'evidence keys exist only in synthetic_locked' using errcode='GW011'; end if;
 if p_class='production' and s.phase<>'synthetic_locked' then raise exception 'the production key is staged only while synthetic_locked' using errcode='GW011'; end if;
 insert into lifecycle.gateway_keys(kid,class,secret,status) values(p_kid,p_class,p_secret,case when p_class='production' then 'staged' else 'active' end);
 perform set_config('lifecycle.in_function','1',true);
 perform lifecycle.log('key',s.phase,s.phase,s.epoch,s.register_seq,'add '||p_class||' '||p_kid,null,null,null);
end $$;
alter function lifecycle.add_key(text,text,bytea) owner to lifecycle_owner;

create function lifecycle.revoke_key(p_kid text) returns void language plpgsql security definer set search_path='' as $$
declare s lifecycle.project_state;
begin
 select * into s from lifecycle.project_state;
 update lifecycle.gateway_keys set status='revoked' where kid=p_kid;
 if not found then raise exception 'unknown key' using errcode='GW020'; end if;
 perform lifecycle.log('key',s.phase,s.phase,s.epoch,s.register_seq,'revoke '||p_kid,null,null,null);
end $$;
alter function lifecycle.revoke_key(text) owner to lifecycle_owner;

create function lifecycle.set_real_data_attested(v boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform set_config('lifecycle.in_function','1',true);
 update lifecycle.project_state set real_data_attested=v;
end $$;
alter function lifecycle.set_real_data_attested(boolean) owner to lifecycle_owner;

-- Raise-only token floor for incidents (section 7.2 R2).
create function lifecycle.raise_token_floor(p_floor bigint) returns void language plpgsql security definer set search_path='' as $$
declare s lifecycle.project_state;
begin
 select * into s from lifecycle.project_state for update;
 if p_floor<=s.token_floor then raise exception 'token floor can only be raised' using errcode='GW012'; end if;
 perform set_config('lifecycle.in_function','1',true);
 update lifecycle.project_state set token_floor=p_floor,changed_at=clock_timestamp(),changed_by=session_user::text;
 perform lifecycle.log('token_floor',s.phase,s.phase,s.epoch,s.register_seq,'floor '||p_floor,null,null,null);
end $$;
alter function lifecycle.raise_token_floor(bigint) owner to lifecycle_owner;

-- The only way to change phase. Allowed: preproduction->synthetic_locked, synthetic_locked->preproduction (only while
-- real_data_attested is false), synthetic_locked->production. There is no path out of production (section 5.1).
create function lifecycle.transition(p_to text, p_expected_epoch bigint, p_register_seq bigint, p_evidence text,
  p_freeze_last_issued_at timestamptz default null, p_v_att interval default null, p_margin interval default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare s lifecycle.project_state; barrier timestamptz; floor_value bigint; staged integer;
begin
 select * into s from lifecycle.project_state for update;
 if s.epoch<>p_expected_epoch then raise exception 'stale epoch: marker is at %, operator supplied %',s.epoch,p_expected_epoch using errcode='GW013'; end if;
 if not ((s.phase='preproduction' and p_to='synthetic_locked') or (s.phase='synthetic_locked' and p_to in ('preproduction','production'))) then
  raise exception 'transition % -> % is not allowed',s.phase,p_to using errcode='GW014'; end if;
 if p_to='preproduction' and s.real_data_attested then raise exception 'cannot demote: real data attested' using errcode='GW014'; end if;
 if p_register_seq is null or p_register_seq<=s.register_seq then raise exception 'register seq must increase' using errcode='GW015'; end if;
 if p_to='production' then
  if p_freeze_last_issued_at is null or p_v_att is null or p_margin is null then raise exception 'barrier inputs required' using errcode='GW016'; end if;
  barrier:=p_freeze_last_issued_at+p_v_att+p_margin;
  if clock_timestamp()<barrier then raise exception 'barrier B not reached: B=%, now=%',barrier,clock_timestamp() using errcode='GW017'; end if;
  select count(*) into staged from lifecycle.gateway_keys where class='production' and status='staged';
  if staged<>1 then raise exception 'exactly one staged production key required, found %',staged using errcode='GW018'; end if;
 end if;
 perform set_config('lifecycle.in_function','1',true);
 if p_to='synthetic_locked' then update lifecycle.gateway_keys set status='revoked' where class='test' and status<>'revoked'; end if;
 if p_to='preproduction' then update lifecycle.gateway_keys set status='revoked' where class in ('evidence','production') and status<>'revoked'; end if;
 if p_to='production' then
  update lifecycle.gateway_keys set status='revoked' where class in ('test','evidence') and status<>'revoked';
  update lifecycle.gateway_keys set status='active' where class='production' and status='staged';
  floor_value:=ceil(extract(epoch from clock_timestamp()))::bigint;
 end if;
 update lifecycle.project_state set phase=p_to,epoch=s.epoch+1,register_seq=p_register_seq,token_floor=greatest(s.token_floor,coalesce(floor_value,0)),
  changed_at=clock_timestamp(),changed_by=session_user::text,evidence_digest=p_evidence;
 perform lifecycle.log('transition',s.phase,p_to,s.epoch+1,p_register_seq,p_evidence,p_freeze_last_issued_at,barrier,null);
 return s.epoch+1;
end $$;
alter function lifecycle.transition(text,bigint,bigint,text,timestamptz,interval,interval) owner to lifecycle_owner;

-- Canonical, length-prefixed, type-tagged digest of the function name and EVERY argument (explicit NULL marker).
create function lifecycle.args_digest(p_fn text, p_args text[]) returns text language plpgsql immutable security definer set search_path='' as $$
declare s text:='F'||octet_length(p_fn)||':'||p_fn||'|A'||coalesce(array_length(p_args,1),0); i integer; a text;
begin
 for i in 1..coalesce(array_length(p_args,1),0) loop
  a:=p_args[i];
  s:=s||'|'||case when a is null then 'N' else 'S'||octet_length(a)||':'||a end;
 end loop;
 return encode(extensions.digest(convert_to(s,'UTF8'),'sha256'),'hex');
end $$;
alter function lifecycle.args_digest(text,text[]) owner to lifecycle_owner;

-- Verifies a proof for one call. p_typ 'user' binds actor and session to the request's JWT claims; 'server' binds a route
-- name and requires no user session. Raises a distinct GW0xx SQLSTATE per refusal. Retryable: GW001 only.
create function lifecycle.verify_proof(p jsonb, p_fn text, p_ad text, p_typ text, p_single_use boolean, p_subs text[] default null)
returns void language plpgsql security definer set search_path='' as $$
declare s lifecycle.project_state; k lifecycle.gateway_keys; canon text; expected_mac text; rk bytea; claims jsonb; now_s numeric:=extract(epoch from clock_timestamp());
 field text;
begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception 'proof missing' using errcode='GW010'; end if;
 foreach field in array array['v','typ','kid','aud','epoch','fn','ad','iat','exp','mac'] loop
  if p->field is null or jsonb_typeof(p->field)='null' then raise exception 'proof field % missing',field using errcode='GW010'; end if;
 end loop;
 if p->>'v'<>'1' then raise exception 'unsupported proof version' using errcode='GW010'; end if;
 select * into s from lifecycle.project_state;
 select * into k from lifecycle.gateway_keys where kid=p->>'kid';
 if not found then raise exception 'unknown key' using errcode='GW020'; end if;
 canon:=concat_ws(E'\n',p->>'v',p->>'typ',p->>'kid',p->>'aud',p->>'epoch',coalesce(p->>'sub',''),coalesce(p->>'sid',''),coalesce(p->>'jti',''),p->>'fn',p->>'ad',p->>'iat',p->>'exp');
 expected_mac:=encode(extensions.hmac(convert_to(canon,'UTF8'),k.secret,'sha256'),'hex');
 -- Constant-time comparison: compare MACs of both values under a fresh random key.
 rk:=extensions.gen_random_bytes(16);
 if extensions.hmac(convert_to(expected_mac,'UTF8'),rk,'sha256') is distinct from extensions.hmac(convert_to(p->>'mac','UTF8'),rk,'sha256') then raise exception 'bad proof MAC' using errcode='GW030'; end if;
 -- The MAC is valid: everything below is trusted to have been written by a key holder, and is checked against THIS call.
 if k.status<>'active' or (k.not_before is not null and clock_timestamp()<k.not_before) or (k.not_after is not null and clock_timestamp()>k.not_after) then raise exception 'key not active' using errcode='GW021'; end if;
 if not ((s.phase='preproduction' and k.class='test') or (s.phase='synthetic_locked' and k.class='evidence') or (s.phase='production' and k.class='production')) then
  raise exception 'key class % not accepted in phase %',k.class,s.phase using errcode='GW022'; end if;
 if p->>'aud'<>s.project_ref then raise exception 'wrong project' using errcode='GW031'; end if;
 if (p->>'epoch')::bigint<>s.epoch then raise exception 'wrong epoch' using errcode='GW032'; end if;
 if p->>'fn'<>p_fn then raise exception 'proof is for another function' using errcode='GW033'; end if;
 if p->>'ad'<>p_ad then raise exception 'proof does not match these arguments' using errcode='GW034'; end if;
 if p->>'typ'<>p_typ then raise exception 'wrong proof type' using errcode='GW035'; end if;
 if (p->>'iat')::numeric>now_s+5 or (p->>'exp')::numeric<=now_s or (p->>'exp')::numeric-(p->>'iat')::numeric>60 then raise exception 'proof expired or not yet valid' using errcode='GW001'; end if;
 if p_typ='user' then
  claims:=auth.jwt();
  if auth.uid() is null or p->>'sub' is distinct from auth.uid()::text then raise exception 'proof is for another actor' using errcode='GW050'; end if;
  if coalesce(claims->>'session_id','')='' or p->>'sid' is distinct from claims->>'session_id' then raise exception 'proof is for another session' using errcode='GW051'; end if;
  if s.token_floor>0 and coalesce((claims->>'iat')::bigint,0)<s.token_floor then raise exception 'token was issued before the lifecycle floor' using errcode='GW052'; end if;
 else
  if p_subs is null or not (p->>'sub'=any(p_subs)) or p->>'sid' is not null then raise exception 'not an allowed server principal' using errcode='GW060'; end if;
 end if;
 if p_single_use then
  if coalesce(p->>'jti','')='' then raise exception 'single-use proof needs a jti' using errcode='GW010'; end if;
  begin
   insert into lifecycle.proof_uses(jti,fn,exp) values(p->>'jti',p_fn,to_timestamp((p->>'exp')::numeric));
  exception when unique_violation then raise exception 'proof already used' using errcode='GW040';
  end;
 end if;
end $$;
alter function lifecycle.verify_proof(jsonb,text,text,text,boolean,text[]) owner to lifecycle_owner;

-- Who may do what.
revoke all on all functions in schema lifecycle from public;
grant usage on schema lifecycle to lifecycle_operator;
grant execute on function lifecycle.transition(text,bigint,bigint,text,timestamptz,interval,interval), lifecycle.add_key(text,text,bytea), lifecycle.revoke_key(text),
 lifecycle.raise_token_floor(bigint), lifecycle.set_real_data_attested(boolean), lifecycle.verify_chain() to lifecycle_operator;
-- The wrapper owner may verify proofs and nothing else in lifecycle.
grant usage on schema lifecycle to gw_owner;
grant execute on function lifecycle.verify_proof(jsonb,text,text,text,boolean,text[]), lifecycle.args_digest(text,text[]) to gw_owner;
-- Re-assert: no Data API role, no custom test role, no PUBLIC access.
revoke all on schema lifecycle from anon, authenticated, service_role, authenticator, proto_agent, proto_nobody;
