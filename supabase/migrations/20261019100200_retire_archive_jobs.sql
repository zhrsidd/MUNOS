-- Drive mirroring is retired. public.archive_jobs was created for it in the foundation migration and has never
-- been written or read by the application, the snapshots or any function. Drop it with its policy and index.
-- Destructive by design; the table is empty in every environment that has only run the application.
-- Verify before applying on any project: select count(*) from public.archive_jobs;  (expected 0)
do $$ begin
 if exists (select 1 from public.archive_jobs) then raise exception 'archive_jobs has rows; review before dropping'; end if;
end $$;
drop table public.archive_jobs;
