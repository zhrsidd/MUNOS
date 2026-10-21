# Operations documentation

**Development baseline only.** No production project or known-good Vercel deployment has been established yet. Name a lead administrator and deputy before the rehearsal and record their contact details and authorized accounts in the runbook.

This page used to hold the conference-day notes. They now live in:

- [CONFERENCE_RUNBOOK.md](../CONFERENCE_RUNBOOK.md) — organizer checklists and procedures (print this).
- [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md) — one-page emergency sheet.
- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) — gates from development to Production and the T-48h freeze.
- [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) — current v1 status per gate: verified, outstanding, release blockers and owner approvals.
- [STAFF_REHEARSAL.md](STAFF_REHEARSAL.md) — 30–45 minute staff familiarisation rehearsal (no load).
- [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md) — one-time first-Executive access code for a brand-new project.
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — technical contact: health details, access codes, unsynced/conflict recovery, Supabase/Vercel checks, end-of-conference clean-up.
- [DEPLOYMENT.md](DEPLOYMENT.md) — release model (`main` → Preview, `production` → Production), known-good release, 48-hour freeze, emergency fixes, rollback.
- [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md) — the conference-week load and failure rehearsal (on Supabase Pro/Small).
- [GOOGLE_WORKSPACE_ACCESS_MODEL.md](GOOGLE_WORKSPACE_ACCESS_MODEL.md) — how delegates share Google Docs with Chairs.

## Retired: Google Drive mirroring

Drive mirroring and automation will not be used. The application contains no Drive API code, dependency, job,
setting or credential. Ordinary Google Docs links, and the Chair's manual copy into the Approval Panel's folder,
remain. Historical review documents under `docs/` that mention "future Drive automation" are dated records.

Resources outside the repository that may exist and need retiring by their owner (none were created by the
repository; confirm each before deleting):

- [ ] A Google Shared Drive or folder tree created for mirroring or archive (keep the Approval Panel's manual folder).
- [ ] A Google Cloud project, the Drive API enablement, any service account and its keys, and any workload identity setup created for Drive automation.
- [ ] Shared Drive membership granted to such a service account or automation user.
- [ ] Any Vercel, Supabase or GitHub secret holding Drive credentials, and any scheduled job or webhook that called Drive.
- [ ] A dedicated Google Workspace "automation" user, if one was created.
