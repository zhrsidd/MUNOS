-- Drive mirroring is retired. public.archive_jobs was created for it in the foundation migration and has never
-- been written or read by the application, the snapshots or any function. Drop it with its policy and index.
-- Destructive by design. The guard is race-free: the exclusive lock is taken BEFORE the emptiness check and held
-- through the drop, all inside one statement, so no writer can commit a row between the check and the drop.
-- Apply in a quiet deployment window; the lock timeout makes a blocked migration fail instead of waiting forever.
do $$
begin
 perform set_config('lock_timeout', '10s', true);
 lock table public.archive_jobs in access exclusive mode;
 if exists (select 1 from public.archive_jobs) then raise exception 'archive_jobs has rows; review before dropping'; end if;
 drop table public.archive_jobs;
end $$;
