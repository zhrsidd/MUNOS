# Human cutover handover · 1 November 2026

**Production still uses the demo backend. The database is still preproduction.** No real conference has been created and no synthetic conference has been deleted. The owner chose **PITR off, daily backups**.

The [verification record](../../evidence/cutover-2026-11-01/VERIFICATION.md) separates completed checks from the remaining release gates. Follow the full [cutover checklist](../../CUTOVER_PREP_2026-11-01.md) for the authoritative order and responsibilities. These files prepare that procedure; they do not approve production promotion.

## What is ready

- The amendment-link lookup defect is fixed and verified on the deployed test build. The hosted ledger now has **38 migrations**, through `20261101100000_amendment_link_committee_scope`.
- Real Chromium checks covered Realtime, reconnect, offline reload, roll-call correction, ballot eligibility, speeches, Approval comments/history and printing against synthetic preproduction data.
- The deployed test build serves valid resolution and amendment forms and rejects a PDF link before submitting it. No real document or amendment was submitted.
- The temporary browser fixture's grants, codes and public links are revoked. A valid, unexpired caller was denied fresh reads/writes, with its saved action retained in the outbox.
- The real conference UUID is reserved in [manifest.json](manifest.json), and [production.env.example](production.env.example) matches it. It does not exist in the database yet.

## Do these next, in order

1. **Close the release decisions.** Have the owner, independent reviewer and release approver consider [CAPACITY_REVIEW.md](../../evidence/cutover-2026-11-01/CAPACITY_REVIEW.md). The full H3 runner passes, but retained IO/swap and watcher cadence evidence is incomplete, and request-by-request correlation is unproven. A new hosted re-query matches the runner's aggregate write count (2,072 rows); the old 45-row gap is superseded, although one request ID appears twice. Recover missing resource evidence or record explicit decisions about the remaining limitations. No operator or agent may silently waive it. Select the final green source SHA, obtain independent review and John Paul Ribeiru's exact-SHA release approval, and name a compatible rollback build. The prepared SQL files in this folder have only been exercised locally and still need independent human review before execution.
2. **Stop test access.** Agree a write pause. Close test browsers and runners. In Vercel → `munos` → Deployments, delete all connected Previews listed in the cutover checklist, including the `codex/owner-review-preview` deployment. Delete the temporary H3 sharing access too. Confirm the old URLs say deployment not found. Removing an alias or environment value alone does not retire an immutable deployment.
3. **Retire authority and agent access, using a human-owned connection.** On the verified `kllhswucdhqqywnzxado` preproduction project, independently review and run [retire-all-test-authority.sql](retire-all-test-authority.sql). It takes the lifecycle lock, verifies exactly the ten known synthetic conferences and revokes all test grants/codes/links in one transaction; it deletes no data. Then invalidate test Auth sessions and refresh capability using supported Supabase administrative controls. Rotate/delete test API keys, management tokens and database credentials, disconnect the Supabase/Vercel agent connectors, and remove hosted settings from Preview, Development and agent environments. Keep only the human cleanup connection and its staging allow-list until cleanup completes. Do not send new credentials to an agent.
4. **Clean the synthetic data.** Record the latest daily backup. Independently review [relabel-legacy-synthetic.sql](relabel-legacy-synthetic.sql), then run it to rename just the known old `TEST Offline Rehearsal` fixture to a prefix accepted by the existing cleanup tool. Follow [SYNTHETIC_CLEANUP.md](../../SYNTHETIC_CLEANUP.md): dry run, second-person review, owner approval, then the hash-confirmed execute. See the explicit scope below. Delete only the separately listed Storage objects and Auth users after conference cleanup; verify nothing remains to delete. Do not delete Auth users first.
5. **Finish isolation and wait.** Remove the ref from every remaining operator staging/development allow-list after cleanup. Wait at least **3,600 seconds plus the recorded clock margin** after the last possible test-token issuance, and longer if any old token lasts longer. The global wait has **not** started: 147 Auth sessions remained at the final inventory. Our last possible local test refresh was `2026-11-01T09:36:52.662Z` (12:36:52 Qatar); this is not a global cutoff. If anything can still mint or refresh a token, stop it and restart the clock.
6. **Promote and release.** Review [production-registry.patch](production-registry.patch), apply it in a separate source PR, run CI and obtain exact-SHA approval. It is deliberately not applied here. After all earlier gates, a human runs [mark-production.sql](mark-production.sql). Use [production.env.example](production.env.example) for Vercel **Production only**, with newly rotated keys. Keep new Previews in demo mode. Configure public Production access without a Vercel login; keep Previews protected. Release through the protected `production` branch. Verify SHA, target and health, and retain a verified rollback deployment built with the new credentials. Cloud agents must have no live project access after promotion.
7. **Open the real conference.** After final owner infrastructure approval and John Paul Ribeiru's release sign-off, a human reviews/runs [create-real-conference.sql](create-real-conference.sql) once. It creates the protected real conference shell with UUID `586db0d4-dde5-40a1-a50e-f925fce7e70a`. Follow [FIRST_EXECUTIVE_BOOTSTRAP.md](../../FIRST_EXECUTIVE_BOOTSTRAP.md); give its temporary code to the first Executive in person. Issue real staff codes and QR links from the app. On a normal phone using mobile data, without Vercel login, check the staff page and both valid public forms without submitting test data. Only then begin real-data entry.

## Exact synthetic cleanup scope

The owner must approve deleting all ten IDs in [manifest.json](manifest.json), including the original development/owner-review conferences. Their deliberate inclusion must be reviewed; do not bypass the cleanup protections. In the human operator's ignored `.env.local`, use the verified project's URL/DB connection and staging allow-list. Set `NEXT_PUBLIC_CONFERENCE_ID` to the reserved real UUID above so it remains protected, and review any `PROTECTED_CONFERENCE_IDS`; do not silently remove other protected IDs.

From the reviewed repository revision, run this **dry run only**:

```sh
npm run cleanup:synthetic -- \
  --conference 0331ceb6-3fa8-4731-92cb-2b4c0316d0cb \
  --conference 5d9f8e82-13dc-4f90-8fde-bed46bcb0741 \
  --conference e3a38dc2-58ca-4ef5-a962-aaab6794717e \
  --conference a410008d-8d79-478c-9a08-341952f6af0a \
  --conference ac63e049-b89d-40c6-88a4-f635dd6fad80 \
  --conference 573cfbeb-d3ed-4cf5-b418-7d36326f69c8 \
  --conference 1e6bb11f-95c2-4acc-9849-2047818cbdd4 \
  --conference bd211427-4dda-40b0-953e-651dfe5a2a57 \
  --conference ee243abf-e315-4c9c-a83f-a523b89bb42a \
  --conference 2067d8be-48cb-4b55-a139-3c8be42b4c51
```

Review the returned names, row counts, fingerprints, conferences that stay, Storage keys and Auth candidates with another person. For execution, repeat the exact same ID arguments and add `--execute --token <fresh-dry-run-token> --backup-evidence '<recorded backup reference>' --owner-approval '<explicit approval reference>'`. Keep the confirmation token and credentials out of chat and version control. If execution has an unknown outcome, reconcile with a read-only dry run before retrying.

Stop if the inventory differs from these ten IDs or contains any real-data flag. Do not add new fixtures, run hosted rehearsals or retrieve production keys after promotion.
