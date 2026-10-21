-- PROTOTYPE, NOT SHIPPING, NOT A MIGRATION. Gateway wrapper functions (docs/ISOLATION_DESIGN.md sections 6.3 and 6.4).
-- Every argument is received as text so the proof digest covers exactly the bytes the gateway sent (no uuid, timestamptz
-- or jsonb re-rendering can make the digest differ). After the proof verifies, each wrapper casts and calls the EXISTING
-- function unchanged. Wrappers are SECURITY DEFINER, owned by gw_owner (a NOLOGIN, non-superuser role).

-- gw_owner must be able to call what it wraps, and nothing else. This explicit grant list is itself part of the finding.
grant usage on schema public, private to gw_owner;
grant execute on function
 public.apply_conference_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz),
 public.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz),
 public.redeem_access_code(uuid,text),
 public.rotate_access_code(uuid,public.conference_role,uuid,timestamptz),
 public.revoke_access_code(uuid,uuid,boolean),
 public.submit_resolution(text,uuid,uuid,text,text,text,text,text,integer),
 public.submit_amendment(text,uuid,uuid,uuid,text,text,text),
 private.apply_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz),
 private.apply_operations_mutation(uuid,uuid,jsonb,public.conference_role,text,timestamptz),
 private.apply_procedure(uuid,uuid,jsonb,public.conference_role,text,timestamptz),
 private.apply_staff_batch(uuid,uuid,jsonb,public.conference_role,text,timestamptz)
 to gw_owner;

-- User principal, staff mutations (family M). Same six arguments as the originals, plus the proof.
create function public.gw_apply_conference_mutation(conf text, mutation text, command text, requested_role text, expected text, client_time text, proof jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'apply_conference_mutation',lifecycle.args_digest('apply_conference_mutation',array[conf,mutation,command,requested_role,expected,client_time]),'user',false);
 perform public.apply_conference_mutation(conf::uuid,mutation::uuid,command::jsonb,requested_role::public.conference_role,expected,client_time::timestamptz);
end $$;
alter function public.gw_apply_conference_mutation(text,text,text,text,text,text,jsonb) owner to gw_owner;

create function public.gw_apply_operations_mutation(conf text, mutation text, command text, requested_role text, expected text, client_time text, proof jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'apply_operations_mutation',lifecycle.args_digest('apply_operations_mutation',array[conf,mutation,command,requested_role,expected,client_time]),'user',false);
 perform public.apply_operations_mutation(conf::uuid,mutation::uuid,command::jsonb,requested_role::public.conference_role,expected,client_time::timestamptz);
end $$;
alter function public.gw_apply_operations_mutation(text,text,text,text,text,text,jsonb) owner to gw_owner;

-- User principal, access codes (family A). rotate and revoke have no receipt of their own, so their proofs are single use.
create function public.gw_redeem_access_code(conf text, code text, proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- The digest covers the code through the whole argument list; the code is never copied into the proof.
 perform lifecycle.verify_proof(proof,'redeem_access_code',lifecycle.args_digest('redeem_access_code',array[conf,code]),'user',false);
 return public.redeem_access_code(conf::uuid,code);
end $$;
alter function public.gw_redeem_access_code(text,text,jsonb) owner to gw_owner;

create function public.gw_rotate_access_code(conf text, requested_role text, committee text, expires_at text, proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'rotate_access_code',lifecycle.args_digest('rotate_access_code',array[conf,requested_role,committee,expires_at]),'user',true);
 return public.rotate_access_code(conf::uuid,requested_role::public.conference_role,committee::uuid,expires_at::timestamptz);
end $$;
alter function public.gw_rotate_access_code(text,text,text,text,jsonb) owner to gw_owner;

create function public.gw_revoke_access_code(conf text, credential text, revoke_devices text, proof jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'revoke_access_code',lifecycle.args_digest('revoke_access_code',array[conf,credential,revoke_devices]),'user',true);
 perform public.revoke_access_code(conf::uuid,credential::uuid,revoke_devices::boolean);
end $$;
alter function public.gw_revoke_access_code(text,text,text,jsonb) owner to gw_owner;

-- Server principal (family S): no user session. The caller is the Production server route (service_role) AND holds the key.
create function public.gw_submit_resolution(link_token text, submission text, submitter text, title text, google_doc_id text, file_name text, storage_key text, file_sha256 text, file_size text, proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'submit_resolution',lifecycle.args_digest('submit_resolution',array[link_token,submission,submitter,title,google_doc_id,file_name,storage_key,file_sha256,file_size]),'server',false,array['route:submissions']);
 return public.submit_resolution(link_token,submission::uuid,submitter::uuid,title,google_doc_id,file_name,storage_key,file_sha256,file_size::integer);
end $$;
alter function public.gw_submit_resolution(text,text,text,text,text,text,text,text,text,jsonb) owner to gw_owner;

create function public.gw_submit_amendment(link_token text, submission text, submitter text, resolution text, amendment_type text, clause text, wording text, proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'submit_amendment',lifecycle.args_digest('submit_amendment',array[link_token,submission,submitter,resolution,amendment_type,clause,wording]),'server',false,array['route:amendments']);
 return public.submit_amendment(link_token,submission::uuid,submitter::uuid,resolution::uuid,amendment_type,clause,wording);
end $$;
alter function public.gw_submit_amendment(text,text,text,text,text,text,text,jsonb) owner to gw_owner;

-- Experiment only: the SECURITY INVOKER variant of the first wrapper, to show empirically why it cannot be used.
create function public.gw_invoker_apply_conference_mutation(conf text, mutation text, command text, requested_role text, expected text, client_time text, proof jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform lifecycle.verify_proof(proof,'apply_conference_mutation',lifecycle.args_digest('apply_conference_mutation',array[conf,mutation,command,requested_role,expected,client_time]),'user',false);
 perform public.apply_conference_mutation(conf::uuid,mutation::uuid,command::jsonb,requested_role::public.conference_role,expected,client_time::timestamptz);
end $$;

-- Observation probes (identity visible inside a definer function versus an invoker function).
create schema proto_probe;
grant usage on schema proto_probe to public;
create function proto_probe.who() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('uid',auth.uid(),'current_user',current_user,'session_user',session_user,'role_guc',current_setting('role',true),'claims_sub',auth.jwt()->>'sub','claims_session',auth.jwt()->>'session_id') $$;
grant execute on function proto_probe.who() to public;
-- Probe only: this definer function itself reads auth.*, so its owner needs the grant. The real wrappers do not touch auth.* themselves.
grant usage on schema auth to gw_owner;
grant execute on function auth.uid(), auth.jwt() to gw_owner;
create function proto_probe.gw_who() returns jsonb language sql stable security definer set search_path='' as $$ select proto_probe.who() $$;
alter function proto_probe.gw_who() owner to gw_owner;
grant execute on function proto_probe.gw_who() to public;

-- Pass-through pairs (no proof): the same call made by an INVOKER and a DEFINER function, to isolate what changes when the
-- callee's EXECUTE is revoked from authenticated.
create function proto_probe.invoker_pass(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security invoker set search_path='' as $$ begin perform public.apply_conference_mutation(conf,mutation,command,requested_role,expected,client_time); end $$;
create function proto_probe.definer_pass(conf uuid, mutation uuid, command jsonb, requested_role public.conference_role, expected text, client_time timestamptz)
returns void language plpgsql security definer set search_path='' as $$ begin perform public.apply_conference_mutation(conf,mutation,command,requested_role,expected,client_time); end $$;
alter function proto_probe.definer_pass(uuid,uuid,jsonb,public.conference_role,text,timestamptz) owner to gw_owner;
grant execute on function proto_probe.invoker_pass(uuid,uuid,jsonb,public.conference_role,text,timestamptz), proto_probe.definer_pass(uuid,uuid,jsonb,public.conference_role,text,timestamptz) to authenticated;

-- The wrappers' own EXECUTE: user wrappers to authenticated, server wrappers to service_role, nothing to anon or PUBLIC.
revoke all on function
 public.gw_apply_conference_mutation(text,text,text,text,text,text,jsonb), public.gw_apply_operations_mutation(text,text,text,text,text,text,jsonb),
 public.gw_redeem_access_code(text,text,jsonb), public.gw_rotate_access_code(text,text,text,text,jsonb), public.gw_revoke_access_code(text,text,text,jsonb),
 public.gw_submit_resolution(text,text,text,text,text,text,text,text,text,jsonb), public.gw_submit_amendment(text,text,text,text,text,text,text,jsonb),
 public.gw_invoker_apply_conference_mutation(text,text,text,text,text,text,jsonb)
 from public, anon, authenticated, service_role;
grant execute on function
 public.gw_apply_conference_mutation(text,text,text,text,text,text,jsonb), public.gw_apply_operations_mutation(text,text,text,text,text,text,jsonb),
 public.gw_redeem_access_code(text,text,jsonb), public.gw_rotate_access_code(text,text,text,text,jsonb), public.gw_revoke_access_code(text,text,text,jsonb),
 public.gw_invoker_apply_conference_mutation(text,text,text,text,text,text,jsonb)
 to authenticated;
grant execute on function
 public.gw_submit_resolution(text,text,text,text,text,text,text,text,text,jsonb), public.gw_submit_amendment(text,text,text,text,text,text,text,jsonb)
 to service_role;
