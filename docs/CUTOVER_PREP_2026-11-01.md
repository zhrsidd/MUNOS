# Cutover preparation checklist, 1 November 2026

A simple, ordered list for the production cutover. It adds no approval and changes no procedure: [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) governs, and every cutover step is human-controlled and recorded. Evidence for the capacity run: [load-2026-11-01 summary](evidence/load-2026-11-01/SUMMARY.md).

Dates: 2 November is for fixes only. The 48-hour freeze starts 3 November. The conference is 5 to 7 November.

## Verified on 1 November

- [x] Candidate `032daa5`; staging ledger at 37 migrations through `20261101090000_snapshot_committee_prefilter`.
- [x] Staging is Pro, Small compute, 90 connections. PITR is **off** and the last backup was 31 October 08:52 UTC.
- [x] H3 (110 staff, 30 minutes, 19 committees) passed as a READINESS RUN. R3 passed.
- [x] 0 live grants on any conference, both load fixtures revoked, original-conference fingerprint unchanged.
- [x] Staging holds nine conferences, all synthetic; 0 non-test grants. No real conference data has been entered.
- [x] The owner deleted the metrics key, rotated the Vercel bypass secret, closed the operator terminals and deleted the session files.

## Retire the connected Previews (owner, Vercel dashboard)

Claude's Vercel connector cannot delete deployments. In the Vercel dashboard, project `munos`, Deployments, filter branch `codex/preproduction-connected`, delete each:

| Deployment | Built from |
| --- | --- |
| `dpl_AgKbB2jJNzS3hpnMhvPCS63JNmwg` (`munos-cj59l3s5l-dcmun.vercel.app`) | `032daa5`, 1 Nov (the H3 candidate) |
| `dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR` (`munos-jij0int7d-dcmun.vercel.app`) | `288c723`, 31 Oct |
| `dpl_EQboPWUsbX4MfMGYYxekPJ8p1JPu` (`munos-7hptv216n-dcmun.vercel.app`) | `4db21e5`, 26 Oct |
| `dpl_F9E3JM5kvrzE3xAgoi7ChA2LPrGW` (`munos-92nfadxi8-dcmun.vercel.app`) | `5911d03`, 26 Oct |
| `dpl_7XxtobS1AYLP4gdTtD4GriuWACAw` (`munos-bf56arr56-dcmun.vercel.app`) | `e90686b`, 25 Oct |
| `dpl_F9e5BBiNSpmRUoW4wAT4ayYzLzvC` (`munos-pkwytp1dc-dcmun.vercel.app`, target `staging`) | `3e282f7`, 25 Oct |

The branch alias `munos-git-codex-preproduction-connected-dcmun.vercel.app` goes with them. Then confirm the list for that branch is empty. Do not push to that branch name again.

## Cutover steps (human-controlled, in order, from the lifecycle document)

1. [ ] Freeze the candidate SHA and the migration ledger. Reconcile synthetic work and keep the evidence.
2. [ ] Guarded cleanup of synthetic records on the verified preproduction target. The two open submission links left on the 20 and 21 October test conferences are part of this (the original conference is protected and goes through the reviewed cleanup tooling only). Confirm no real data.
3. [ ] Disable cloud-agent access to the project: Supabase and Vercel connectors, access tokens, secret and service keys, database roles. Revoke agent credentials and refresh sessions.
4. [ ] Revocation wait-out: wait the confirmed 3,600 seconds from the last possible test-token issuance before opening real-data entry.
5. [ ] Remove hosted values from Preview, Development and branch overrides, and from PR CI and agent environments. New Previews build in demo mode.
6. [ ] Promote the lifecycle record: update `config/project-lifecycle.json` and the server lock to production, remove the ref from the staging and development lists, set `EXPECTED_SUPABASE_REF` for Production only. Record time, operator, approvals, ref, Small size, SHA, ledger and backup state.
7. [ ] Release the approved production build from the verified revision with new Production-scoped secrets. Check target, SHA and health with a non-destructive check. Release approval is John Paul Ribeiru's.
8. [ ] Only after the sign-offs: bootstrap the real Executive, then issue real grants, codes and QR links.

## Decisions and sign-offs still open

- [ ] Independent reviewer sign-off and release approver sign-off on the capacity evidence.
- [ ] Backups: PITR is off. Decide before any real data is entered whether to turn it on, and record the choice.
- [ ] Real-browser functional checks on the exact candidate (Chair reconnect, roll-call correction, immutable ballot eligibility, speeches and points, Approval and printing, public resolution and amendment access, revocation).
- [ ] **Real Realtime delivery is a release gate and must be validated before cutover** (Phase A, step 8). The capacity runner only simulates it, and after cutover hosted rehearsal and synthetic writes are prohibited. Dashboard monitoring in the live session supplements this evidence and does not replace it.
- [ ] Not measured in the capacity run: disk IO and swap. Check both in the dashboard during the first live session, as a supplement.
- [ ] Support-role read latency (Admin, Executive and Approval snapshots, 2.7 to 3.4 s p95 at 110 staff) is the next place to improve if time allows. The planned fix is delta reads, documented in [PERFORMANCE_FOLLOWUPS_2026-10-31.md](PERFORMANCE_FOLLOWUPS_2026-10-31.md).

## Manual cutover instructions

These are the hands-on steps for the cutover, in the order [LIFECYCLE_CONTROLS.md](LIFECYCLE_CONTROLS.md) requires (its "Human cutover order") with the commands from [DEPLOYMENT.md](DEPLOYMENT.md), [SYNTHETIC_CLEANUP.md](SYNTHETIC_CLEANUP.md) and [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md). Where those documents differ in detail, follow them, not this page. A failure at any step leaves the project closed to real data: fix it and carry on, and never add a temporary test-access exception.

**People.** *Owner*: Zuhayr Siddique (approves infrastructure and configuration). *Release approver*: John Paul Ribeiru (approves the production release). *Operator*: a human with Supabase dashboard and database access and Vercel access. Claude and Codex do not hold hosted access from Phase C on and are not given any rotated credential.

**Record as you go.** For every step write who did it, the time in UTC and the evidence (a count, a screenshot with no secrets, a command's exit result). Never write a key, code, token or link into the record.

### Phase A: prepare (any time before the write pause; nothing here changes the project)

1. Pick the release candidate: the `main` commit with green CI that you want in production. It is **not** the same commit as the final production source record (Phase E, step 2), because that one changes `config/project-lifecycle.json`.
2. Write down the rollback target: the last known-good Production deployment ID in Vercel. If no Production deployment exists yet, the rollback is the credential-rotated compatible deployment you build in Phase F (see [DEPLOYMENT.md](DEPLOYMENT.md), step 10).
3. Confirm the Supabase ledger matches the repository for the candidate: Supabase dashboard, SQL Editor, `select count(*) from supabase_migrations.schema_migrations;`. It must equal the number of files in `supabase/migrations` (37 on 1 November).
4. Check what Supabase shows for the project: plan Pro, compute Small, latest backup time, PITR state. Decide and record whether to turn PITR on before real data (it is off). Any new spending needs the owner's approval.
5. Review the advisors (Supabase dashboard, Advisors). The known warnings are the access-code `SECURITY DEFINER` functions, the anonymous-policy notices and leaked-password protection. Anything new needs a decision before promotion.
6. Agree the write-pause window with the Executive, and announce it. Nobody should be using the staging project then.
7. Do the real-browser functional checks from the open-decisions list above and record them.
8. **Validate real Realtime delivery** (release gate; see gap G5 in [LOAD_TEST_EXECUTION_PACKET.md](LOAD_TEST_EXECUTION_PACKET.md) and [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md)). It needs synthetic data with test access, so do it **before** Phase B and C, on a fresh fixture with its own grants. It also needs a connected build, so create one temporary connected Preview of the release candidate for this check and delete it in Phase B. With a few real browsers: confirm a change made on one device appears on another through Realtime without a reload, then block `*/realtime/v1/*` (STAGING_REHEARSAL E2) and confirm core actions continue and recover once it is unblocked. Watch the Realtime logs and connection counts in the Supabase dashboard, and record the result, any errors and who ran it. Revoke the fixture afterwards, as for the load runs.

### Phase B: stop test activity (start of the write pause)

1. Make sure nothing is still running: no rehearsal or load runner (`pgrep -af rehearsal-run` prints nothing on every operator machine), no scripts, no open test devices or browsers on the connected Previews.
2. **Retire the connected Previews.** Vercel dashboard, project `munos`, Deployments. Filter by branch `codex/preproduction-connected` and delete every deployment in the table above. Then check the other Preview and Development deployments built while Preview pointed at this project (filter by date and by environment) and delete them too. Record each URL first.
   Deletion is required and nothing else is a substitute: a deployment keeps the Supabase URL, publishable key and (for server routes) secret key it was built with, so Vercel login, removed aliases and changed environment variables do not stop it reaching the project.
3. Open one of the recorded URLs. It should show Vercel's "deployment not found".

### Phase C: retire test access (the owner's database transaction)

Do these in this order, and keep the transaction open until the revocation is verified.

1. In the Supabase SQL Editor (the **verified preproduction project**, name at the top of the page), in one owner transaction, take the exclusive lifecycle lock first: `select pg_advisory_xact_lock(6210692840397143::bigint);`
2. Revoke every remaining test grant, access code and QR/submission/amendment link. For fixtures that is each fixture's own `cleanup.sql`; the two old open links on the 20 and 21 October test conferences and any other test grant are revoked in the same transaction. Verify with read-only counts: no unrevoked `user_access` rows, no unrevoked `private.access_credentials`, no unrevoked `public.submission_links` or amendment links. The promotion in Phase E refuses if any is left.
3. Revoke Auth sessions and refresh capability separately. **Deleting a laptop's session files does not revoke the session.** Supabase dashboard, Authentication, Users: delete the anonymous test users (or revoke their sessions) so refresh tokens stop working. 164 anonymous users exist on 1 November.
4. **Record the last possible test-token issuance time.** For the 1 November run, the operator's preflight record has the time of the last session refresh. If any test token is issued after this, restart the wait in Phase D.
5. Retire the keys and tokens separately: rotate the Supabase secret key (the project has a `SUPABASE_SECRET_KEY` used by the Preview's server routes), delete any other secret or publishable keys made for testing, and revoke every personal access token or management token that agents or test tools used.
6. **Remove cloud-agent access.** Disconnect the Supabase and Vercel connectors that Claude and Codex use, and revoke any database role or password they were given. A connector's access is often organisation-wide, so disconnect the connection itself rather than assuming a per-project limit. Give nobody newly rotated values except the human operators and the Production runtime.
7. Remove `kllhswucdhqqywnzxado` from `STAGING_SUPABASE_REFS` and `DEVELOPMENT_SUPABASE_REFS` everywhere: Vercel environments, every operator shell and every `.env.local`. From then on the load, rehearsal and verification scripts and any new Preview refuse this project, by design.

### Phase D: synthetic cleanup, backup and the token wait

1. **Backup.** Record the plan, PITR state, the latest backup time and the decision to proceed without a restore path if there is none. This reference goes into the cleanup command.
2. **Synthetic cleanup** ([SYNTHETIC_CLEANUP.md](SYNTHETIC_CLEANUP.md)). Check its status line first: it was prepared and tested locally and needed review and the owner's approval before any hosted run. A human operator runs it, on the verified preproduction target, with `psql` installed and `SUPABASE_DB_URL` set in the operator's own shell only. List the conferences by **id** (never by name) with `select id, name, venue, features, created_at from public.conferences order by created_at;` and write the ids down: the 20 and 21 October test conferences, the four `LOAD TEST ·` fixtures, and the synthetic review and rehearsal conferences. The original development test conference is protected by design, and deleting it is a separate owner decision that means deliberately changing `NEXT_PUBLIC_CONFERENCE_ID` for the run.
   - Dry run first: `npm run cleanup:synthetic -- --conference <id> --conference <id>`. Review it with a second person: the conferences named, the "conferences that stay", the row counts, the Storage keys and the Auth candidates. It prints a confirmation token.
   - Execute only with the owner's approval: `npm run cleanup:synthetic -- --conference <id> --conference <id> --execute --token <64 hex> --backup-evidence "<reference>" --owner-approval "<reference>"`. It is one transaction, irreversible, and aborts on any mismatch.
   - Delete the listed Storage objects and Auth users by hand (the tool prints lists and never deletes them), then run the dry run again and expect "nothing to delete".
3. **Confirm no real data exists:** the read-only query above shows only synthetic conferences, and no real Executive has been bootstrapped.
4. **Wait out the tokens.** Wait at least **3,600 seconds** from the last possible test-token issuance (Phase C, step 4), plus the clock margin you record and any longer expiry of older tokens. If any test token is issued again, restart the wait.

### Phase E: promote the project to production (write pause continues)

1. In the Supabase dashboard confirm again that the project name is the intended one.
2. **Prepare the final source record** as its own pull request and its own commit: change `kllhswucdhqqywnzxado` from `preproduction` to `production` in `config/project-lifecycle.json`. This file is a protected path. It needs the owner's direction, independent review, green CI and the release approver's exact-SHA approval. It is a different commit from the candidate, so approve that exact SHA and do not reuse the earlier approval.
3. Under the exclusive lifecycle lock (the same `pg_advisory_xact_lock` as in Phase C), the owner updates the database marker to production. The marker refuses if any test grant, credential or QR link is still unrevoked. It does not prove the cleanup, token expiry, backups or spending approval: you do that.
4. Record the timestamp, operator, approvals, project ref, Small compute, the final SHA, the migration ledger, the backup state and the access-revocation evidence.

### Phase F: production configuration and release

1. **Vercel, Production environment only** (Settings, Environment Variables), with production Supabase values: `EXPECTED_SUPABASE_REF=kllhswucdhqqywnzxado`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_DATA_BACKEND=supabase`, the real `NEXT_PUBLIC_CONFERENCE_ID`, `NEXT_PUBLIC_CONFERENCE_TIMEZONE=Asia/Qatar`, and the newly rotated `SUPABASE_SECRET_KEY` marked Sensitive. Set no Supabase values on Preview: set Preview to `NEXT_PUBLIC_DATA_BACKEND=local` so new Previews are demos.
2. **Deployment Protection:** Production must open without a Vercel account, for conference devices and for delegates' phones on `/submit/*` and `/amend/*`. Use Standard Protection (Previews stay protected). Staff access is still controlled by staff codes and database access rules.
3. **Domains and region:** add the conference domain to Production when ready. Confirm the function region is `bom1`. GitHub: protect `main` and `production` (require the CI / verify check, no force pushes).
4. **Release.** The release approver approves the exact commit. Advance the `production` branch to it through the branch-protection workflow, never with a force-push. Vercel builds Production.
5. Verify: `npm run verify:deployment -- <production-url> <sha>`, then on one device System health shows `<version> · <sha7> · production` with Supabase `ok` and Storage `ok`.
6. **Rollback readiness:** keep the recorded rollback deployment ready (Vercel, Deployments, Promote). Migrations are forward-only and additive, so an app rollback needs no database rollback.

### Phase G: verify isolation (before anyone enters real data)

1. An old Preview URL from Phase B is gone ("deployment not found").
2. Open a newly built Preview: it must not reach the project (a refused build, "Wrong Supabase project" on `/api/health`, or the local demo).
3. Production `/api/health` reports the expected project and `ok`.
4. From a normal phone on mobile data, with no Vercel login: the conference URL shows the staff access-code screen, and a resolution QR and an amendment QR open their forms.
5. Confirm the agent connectors are disconnected and that no one holds a rotated key who shouldn't.
6. The release approver records the sign-off.

### Phase H: first Executive and opening real-data entry

1. Follow [FIRST_EXECUTIVE_BOOTSTRAP.md](FIRST_EXECUTIVE_BOOTSTRAP.md), with the technical lead and the first Executive together in person: in the Supabase SQL Editor of the production project, paste `scripts/bootstrap-first-executive.sql`, set EDIT 1 to the real conference UUID and EDIT 2 to the validity (for example `2 hours`), run the whole script, read the code to the first Executive in person, and do not save, screenshot or paste it.
2. The first Executive redeems it in the normal app (Enter staff access code), then issues the real Executive code with Executive, Access codes, Rotate (this also revokes the bootstrap code), and stores it in the password manager. Verify section B of the script: the bootstrap row is revoked.
3. All other access codes come from the app from then on. Set the first Executive's remaining devices up with the new code before the bootstrap window ends.
4. Record the known-good release: tag the production commit (`git tag -a known-good-dcmun-<yyyy-mm-dd> <sha> -m "Known-good conference release"` and push), add it to [RELEASES.md](RELEASES.md), and print the Known-good card.
5. **Freeze.** From 48 hours before the conference (3 November), set `CONFERENCE_FREEZE=1` on the Production environment. Do not advance `production` or run migrations. Only narrowly scoped emergency fixes with `[emergency]` in the commit message may deploy, as described in [DEPLOYMENT.md](DEPLOYMENT.md).
6. Real conference data may be entered only after every sign-off above is recorded. Keep [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md) printed and in the operations folder.
