-- PROTOTYPE, NOT SHIPPING, NOT A MIGRATION. The "second small migration" of docs/ISOLATION_DESIGN.md section 10 step 5:
-- revoke direct EXECUTE on every guarded write function from PUBLIC and every Data API role. The wrappers (owned by
-- gw_owner, granted above) remain the only path. Read functions are deliberately untouched (decision D8).
revoke all on function
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
 from public, anon, authenticated, service_role, authenticator;
