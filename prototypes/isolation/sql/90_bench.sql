-- PROTOTYPE BENCHMARK HELPER ONLY. Mints a proof inside the database so a pgbench script can include (or exclude) the cost.
-- A real gateway mints in application code; this exists only so the per-call cost of the HMAC and digest work can be
-- separated from the verification and call cost. Not part of any design.
create schema proto_bench;
grant usage on schema proto_bench to public;
create function proto_bench.mint(p_fn text, p_args text[], p_sub text, p_sid text) returns jsonb language plpgsql security definer set search_path='' as $$
declare s lifecycle.project_state; k lifecycle.gateway_keys; ad text; iat bigint:=extract(epoch from clock_timestamp())::bigint; canon text; mac text;
begin
 select * into s from lifecycle.project_state;
 select * into k from lifecycle.gateway_keys where status='active' limit 1;
 ad:=lifecycle.args_digest(p_fn,p_args);
 canon:=concat_ws(E'\n','1','user',k.kid,s.project_ref,s.epoch::text,coalesce(p_sub,''),coalesce(p_sid,''),'',p_fn,ad,iat::text,(iat+60)::text);
 mac:=encode(extensions.hmac(convert_to(canon,'UTF8'),k.secret,'sha256'),'hex');
 return jsonb_build_object('v','1','typ','user','kid',k.kid,'aud',s.project_ref,'epoch',s.epoch,'sub',p_sub,'sid',p_sid,'fn',p_fn,'ad',ad,'iat',iat,'exp',iat+60,'mac',mac);
end $$;
alter function proto_bench.mint(text,text[],text,text) owner to lifecycle_owner;
grant execute on function proto_bench.mint(text,text[],text,text) to public;
