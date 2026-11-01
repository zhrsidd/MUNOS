# Final production source record — draft until the handover gates finish

This change marks only `kllhswucdhqqywnzxado` as production in the committed owner registry. PHESMUN remains forbidden. It does not promote the hosted database, create real data, install credentials or deploy Production.

**Keep this PR a draft and unmerged until credential/connector retirement, cleanup verification, the recorded 3,600-second wait plus margin, and release approvals are complete.** A clean review or CI result does not complete those operator actions. The owner has authorised preparation and reported team/John Paul approval; the final source SHA must still be recorded in the release handover.

The regression test checks the actual committed DCMUN classification, stale staging/development allow-list refusal, both nonproduction deployment modes, the expected Production target, and PHESMUN denial. It failed on the old preproduction record and passed with this change. Synthetic fixtures remain independent of the real project's phase.

Local verification on disposable PostgreSQL 17.11: **1,014 passed, zero failed/skipped**, including the 4,100-cell authorisation matrix. Application/rehearsal typechecks, lint, build and grants inventory check passed. The new committed-registry regression failed against the preceding preproduction record and passes here. No hosted database call was made from this production-classified source.

At the handover, after all gates:

1. Mark this PR ready and merge through the existing Codex/CI protection. Record its exact main SHA.
2. Run the manual CI workflow on that exact main revision, `gh workflow run ci.yml --ref main`, and confirm `verify` passed on that SHA. If main moved, stop and reconcile the selected release revision. No hosted secrets are used by CI.
3. A human promotes the empty verified hosted project's marker with `mark-production.sql`. This is not an agent action after credentials are retired.
4. The human installs the new Production-only credentials and changes backend from local to Supabase. Release that verified revision through the protected production-branch flow, preserving its history; do not force-push. Production must open without Vercel login while Previews remain protected.
5. Verify target/SHA/health and the compatible credential-rotated rollback deployment. Record final sign-off, then create the real conference and bootstrap the Executive as described in `EXECUTION.md`.

The final source record intentionally blocks fresh hosted test tools. Do not work around it with an old checkout, process override, temporary allow-list or another hosted project. After promotion, source review and disposable local synthetic testing remain available; cloud-agent hosted access stays retired.
