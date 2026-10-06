-- One PostgREST round trip per client refresh instead of two (core snapshot + operations_snapshot).
-- Pure composition of the existing snapshot functions: no snapshot SQL is duplicated, no RLS or existing function
-- changes. SECURITY INVOKER, so every underlying read is still evaluated with the caller's RLS.
-- `||` gives right-hand precedence, matching the client's previous {...core, ...operations} merge; a NULL
-- operations result is treated as {} exactly like the client's `operations.data ?? {}`.
create function public.conference_state_snapshot(conf uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.conference_snapshot(conf) || coalesce(public.operations_snapshot(conf), '{}'::jsonb)
$$;

create function public.executive_state_snapshot(conf uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.executive_snapshot(conf) || coalesce(public.operations_snapshot(conf), '{}'::jsonb)
$$;

revoke all on function public.conference_state_snapshot(uuid) from public, anon;
revoke all on function public.executive_state_snapshot(uuid) from public, anon;
grant execute on function public.conference_state_snapshot(uuid) to authenticated;
grant execute on function public.executive_state_snapshot(uuid) to authenticated;
