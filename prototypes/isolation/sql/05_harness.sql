-- PROTOTYPE TEST HARNESS ONLY. Lets a test run one statement as a Data API role with simulated JWT claims, and get the
-- outcome (rows or SQLSTATE + message) back as JSON without aborting the psql session.
-- Behaves like PostgREST's per-request setup: SET LOCAL ROLE plus the request.jwt.claims setting, both transaction-local.
-- Difference from hosted: session_user is the connecting superuser here, authenticator there.
create schema proto_h;
grant usage on schema proto_h to public;
create function proto_h.run(p_role text, p_claims text, p_q text, p_rows boolean) returns jsonb language plpgsql as $$
declare r jsonb; c text; m text;
begin
 if p_claims is not null then perform set_config('request.jwt.claims',p_claims,true); end if;
 if p_role is not null then perform set_config('role',p_role,true); end if;
 begin
  if p_rows then
   execute 'select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from ('||p_q||') t' into r;
   return jsonb_build_object('ok',true,'rows',r);
  end if;
  execute p_q;
  return jsonb_build_object('ok',true);
 exception when others then
  get stacked diagnostics c=returned_sqlstate, m=message_text;
  return jsonb_build_object('ok',false,'code',c,'msg',m);
 end;
end $$;
grant execute on function proto_h.run(text,text,text,boolean) to public;
