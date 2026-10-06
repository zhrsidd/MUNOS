-- Remove inherited, unused view privileges. All browser database access is explicitly SELECT-only.
revoke all on public.participation_history from anon,authenticated;
grant select on public.participation_history to authenticated;
