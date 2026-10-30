-- Closes two items left open by 20261031090000_committee_live_state (docs/SESSION_MODEL.md section 12.11). NOT applied to any hosted project.
--
-- 1. Attendance conversion (section 12.8): each session's attendance becomes one committed, legacy roll call. A roll call is whole, so
--    every delegate of the committee gets a row: the saved status, or Absent when attendance was never taken for that delegate. The roll call
--    is effective at the session's start (the earliest saved mark when the session has no start), so history keeps the presence it had.
--    It carries no time confidence (the marks were never timestamped by a device), which keeps it from authorising anything a trusted
--    roll call does not. Re-running is a no-op: the roll call id is derived from the session id and an existing one is left alone.
-- 2. The timers table is dropped: saved timers are retired (the timer lives on each device) and nothing reads or writes the table.
-- The attendance table itself stays as the historical record the conversion was made from.

insert into public.roll_call (id, revision, conference_id, committee_id, state, observed_at, local_committed_at, server_committed_at, effective_at, legacy, created_by)
select (substr(md5('legacy-roll-call:' || s.id::text), 1, 8) || '-' || substr(md5('legacy-roll-call:' || s.id::text), 9, 4) || '-4' || substr(md5('legacy-roll-call:' || s.id::text), 14, 3)
        || '-a' || substr(md5('legacy-roll-call:' || s.id::text), 18, 3) || '-' || substr(md5('legacy-roll-call:' || s.id::text), 21, 12))::uuid,
       1, s.conference_id, s.committee_id, 'committed',
       coalesce(s."startsAt", min(a."updatedAt")), coalesce(s."startsAt", min(a."updatedAt")), coalesce(s."startsAt", min(a."updatedAt")), coalesce(s."startsAt", min(a."updatedAt")),
       true, '00000000-0000-0000-0000-000000000000'::uuid
  from public.sessions s join public.attendance a on a."sessionId" = s.id
 group by s.id, s.conference_id, s.committee_id, s."startsAt"
on conflict do nothing;

insert into public.roll_call_row (roll_call_id, revision, conference_id, committee_id, delegate_id, status)
select r.id, 1, r.conference_id, r.committee_id, d.id, coalesce(a.status::text, 'Absent')
  from public.roll_call r
  join public.sessions s on r.id = (substr(md5('legacy-roll-call:' || s.id::text), 1, 8) || '-' || substr(md5('legacy-roll-call:' || s.id::text), 9, 4) || '-4' || substr(md5('legacy-roll-call:' || s.id::text), 14, 3)
        || '-a' || substr(md5('legacy-roll-call:' || s.id::text), 18, 3) || '-' || substr(md5('legacy-roll-call:' || s.id::text), 21, 12))::uuid
  join public.delegates d on d.committee_id = r.committee_id and d.conference_id = r.conference_id
  left join public.attendance a on a."sessionId" = s.id and a."delegateId" = d.id
 where r.legacy and r.revision = 1
on conflict do nothing;

drop table public.timers;
