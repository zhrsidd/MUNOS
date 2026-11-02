# Cutover execution and remaining handover · 1 November 2026

## Production activation · 1 November 2026

GitHub independently shows PR #101 merged as `cfa63dbd857e6fa639774b25448f25fc09621673`, push-triggered Actions run [41317959187](https://github.com/zhrsidd/MUNOS/actions/runs/41317959187) succeeded, and `production` points to that SHA. Production ruleset `26307954` is active; the separate `main` ruleset is disabled by owner decision.

The operator reports successful promotion of Supabase project `kllhswucdhqqywnzxado`, rotated Production credentials, and creation of **DCMUN 2026** (DCMUN XVIII, Doha College, starts 5 November 2026), UUID `586db0d4-dde5-40a1-a50e-f925fce7e70a`, with `features.real = true`. Production uses Supabase. The owner reports approval by John Paul Ribeiru and infrastructure/configuration approval by Zuhayr Siddique. No cloud-agent live access or hosted query was used to verify these reports.

The operator reports the `munos` project in team `dcmun` serves [dcmun-os.vercel.app](https://dcmun-os.vercel.app) from READY deployment `dpl_9qhVfe8nbCzKC2ZUBbpm8Nc7KvZ8`, branch `production`, release SHA above, region `bom1`. At `2026-11-01T15:29:48.700Z` the reported health result was overall **ok**: Auth 724 ms, database 620 ms, Storage 478 ms. Initial database and Storage health failures were traced to Production server-credential configuration and corrected before subsequent healthy deployments; no credential is recorded here. The operator also reports that a normal phone opened Production without Vercel authentication; valid QR forms remain to be checked.

The operator reports retained deployment `dpl_9uNaCa71iAU3PJX4hhQxtUWtUQSD` (`munos-i2gf6uea6-dcmun.vercel.app`) previously passed all three health checks and appears in the Instant Rollback picker. It is a **same-revision recovery option**, not an earlier-version rollback drill; no rollback was performed. PITR remains off by owner decision; daily backups are the selected policy. Prior test authority and synthetic data were retired as documented in [EXECUTION.md](EXECUTION.md).

**Still pending:** first Executive bootstrap; temporary-code redemption, normal-code rotation and verification of bootstrap revocation; staff-code issuance; committee, roster and other configuration; resolution and amendment QR-link issuance and both valid forms checked from normal mobile data without submissions; known-good tag and printed operations card; and the 3 November freeze. Do not record codes or private QR tokens here. The capacity and monitoring limitations in [CAPACITY_REVIEW.md](../../evidence/cutover-2026-11-01/CAPACITY_REVIEW.md) remain; release approval does not establish missing measurements.

## Historical preproduction execution

The following records and instructions describe the state at the time; promotion, release and conference creation are now completed as reported above. Do not repeat cleanup, promotion or conference creation.

## Approval and execution record

After the preparation packet was supplied, Zuhayr explicitly delegated execution, said John Paul had approved and the SQL had been reviewed, then granted blanket approval from the whole team. This authorizes the recorded preproduction cleanup; it is not newly recovered monitoring evidence. The disclosed H3 resource-monitoring and request-correlation limitations remain recorded in the capacity review. No new load run, resource-measurement claim, paid service, gateway or attestation was introduced.

- PR #98 passed CI and an independent Codex GitHub review at `196cee7314bf94392bfe5a7b82d7345fb1ff8f49`, then merged through the normal protected workflow as `741faac3bf2969efa0d8524f281ebc4a38f1b9f0`. No gate or branch protection was bypassed. Cloudflare Pages remains a separate failing preview check, as on the previous main; it is not a required Vercel release check.
- All test grants, codes and both kinds of public link were revoked in the reviewed exclusive-lock transaction. The one legacy fixture was renamed by its exact reviewed UUID/name guard; cleanup protections were not widened.
- The owner deleted the old connected Previews. Both `codex/preproduction-connected` and `codex/owner-review-preview` were independently listed through Vercel afterwards: **zero deployments** on each branch.
- Latest backup confirmed before deletion: completed physical daily backup **2128585969**, `2026-10-31T23:23:45.763Z`. PITR remains off by owner decision.
- Cleanup ran the unchanged reviewed `buildScript`/SQL engine through the Supabase SQL connector, after separately validating the repository target guard and protected-ID check. Its ten UUIDs were explicit, the reserved real UUID stayed protected and its token was recomputed under locks. At `2026-11-01T10:26:48.775257Z`, all **35,654** expected synthetic rows were deleted with exact per-step counts. A fresh read-only dry run then reported `nothing_to_delete`, zero reviewed rows and no remaining conferences. There were no Storage objects to remove. See [cleanup-execution.json](../../evidence/cutover-2026-11-01/cleanup-execution.json).
- After conference cleanup, all **175 anonymous test Auth users** were deleted through the supported Auth admin API: 170 conference-linked candidates and five unreferenced anonymous test identities. All were created before cleanup; no email/phone-bearing or nonanonymous users existed. A fresh check confirmed **zero Auth users and zero sessions**. No user token was minted. See [auth-cleanup.json](../../evidence/cutover-2026-11-01/auth-cleanup.json).
- Branch-specific hosted values were cleared to empty, their backend overrides changed to `local`, and test anonymous bootstrap disabled. Environment variable entries still exist; the hosted values were cleared rather than the entries deleted. The old Production test server-key value was also cleared. This does not revoke the underlying Supabase API keys.
- The non-secret Production URL, expected ref, reserved real conference UUID and Qatar timezone were staged. **Backend remains `local`; no newly rotated Production keys were obtained or installed.** No production deployment or public-protection change was made.

Final SQL verification at **10:32:27 UTC (13:32:27 Qatar)**: preproduction revision 1, 38 migrations, **zero conferences, grants, access credentials, submission links, amendment links, Auth users, Auth sessions and Storage objects**. This is the last recorded hosted inventory, not proof that credentials/connectors are retired. Cloud-agent access remains to be disconnected. The global token wait has **not** started.

## Later retirement update · 14:17 Qatar

The owner reported replacement/retirement of the old API keys, database-password rotation, management-token revocation and disconnection of the Supabase/Vercel agent connectors. After confirming that ECC was current and HS256 previously used, the owner confirmed the old HS256 key had been revoked. These are **owner-reported actions**, not a new agent verification. No hosted database or platform query was made after that report. Credential-change step 1 below is complete as reported; do not repeat it.

[RETIREMENT.json](RETIREMENT.json) records the conservative observation-time cutoff **11:17:16 UTC / 14:17:16 Qatar**, the configured 3,600-second lifetime and a 900-second safety margin. **Do not activate before 15:33 Qatar on 1 November.** Restart the wait if test issuance or refresh resumes. This update supersedes the earlier “wait not started” snapshot.

PR #99 subsequently passed CI and independent Codex review and merged as `4989e50dbb85ad3a840b05938c37679eea032fba`. Manual CI on that exact main SHA also passed (Actions run `41299320510`). The reviewed production-branch ruleset was applied as **26307954**: trusted `verify` required, no force-push/deletion and no bypass actors. PR #100 subsequently merged into main as
`277e6c7c4bde7b786680230e98679ddf8dee3e33`.

Manual CI run `41309969309` passed, including the `verify` job.
However, the attempted non-force fast-forward of `production`
to this SHA returned HTTP 422: required status check
`verify` is expected.

The manually dispatched CI check did not satisfy the
production ruleset's required status check. The production
branch was not advanced. A new revision with a successful
push-triggered CI run is required before release.

All seven old immutable test URLs were independently checked without credentials and returned HTTP 404 `DEPLOYMENT_NOT_FOUND`. There is no credential-rotated production rollback deployment yet; a compatible retained rollback remains a gate before real-data entry.

## Historical planned completion steps (do not rerun)

1. **Credential retirement, by the owner.** In Supabase retire the old test publishable/secret and legacy keys as applicable; rotate the database password and revoke test management/PAT access. Keep newly rotated production values with the human operator and Production runtime only. Disconnect the Supabase and Vercel agent connectors. The agent must not receive new credentials or reconnect after promotion. Key/password changes through browser UI require the human to complete them.
2. **Record the cutoff and wait.** Once test refresh capability and credential/connector access are stopped, record the last possible issuance time. Wait at least **3,600 seconds plus a recorded clock margin**, and any longer lifetime of older tokens. If a test token can be issued or refreshed again, restart the wait. The deletion time of the Auth accounts alone is not the global cutoff.
3. **Final source record and branch protection.** Independently review the separate production-registry change, get its CI green, and record the final approved source SHA. The prepared [production-ruleset.json](production-ruleset.json) requires `verify` on `production`, forbids force-push/deletion and permits a verified fast-forward release of the approved SHA. The separate `main` ruleset remains disabled by operator decision; the production ruleset remains active.

   For production releases, a successful manually dispatched CI run (`workflow_dispatch`) is not sufficient to satisfy the protected production branch's required `verify` status check.

   The final approved release commit must have a successful `verify` check from an eligible GitHub Actions event.

   To establish this check, merge the approved release-correction PR into `main` using the GitHub web interface. This must trigger the CI workflow's `push` event on the final main commit.

   Before advancing `production`:

   - Confirm the final main SHA.
   - Confirm a successful push-triggered CI `verify` job on that exact SHA.
   - Confirm `production` is an ancestor of that SHA.
   - Record approval of the final release revision.
   - Advance `production` using the GitHub API with `force=false`.

   Do not disable production branch protection, bypass required checks, force-push, or substitute a manually dispatched CI result.
4. **Human promotion and release.** After the earlier gates, run [mark-production.sql](mark-production.sql) on the intended project. Install the newly rotated publishable and Sensitive server key in **Vercel Production only**, set `NEXT_PUBLIC_DATA_BACKEND=supabase`, and keep staging/development allow-lists empty. Set Production public access without a Vercel account while keeping Previews protected. Release the approved verified SHA on `production`, region `bom1`. Verify deployment SHA/ref/health and retain a compatible rollback deployment built with the new credentials. Agents perform no live database checks after promotion.
5. **Real conference and first Executive.** With final owner and John Paul release sign-off recorded, run [create-real-conference.sql](create-real-conference.sql), then [FIRST_EXECUTIVE_BOOTSTRAP.md](../../FIRST_EXECUTIVE_BOOTSTRAP.md). The UUID must remain `586db0d4-dde5-40a1-a50e-f925fce7e70a`. Give the bootstrap code in person, rotate it through the app, issue real access and QR links, and check both valid forms from a normal phone without submitting test data. Real-data entry starts only after those gates.

Do not re-run the completed synthetic cleanup or restore retired test deployments. A newly observed conference, Auth user, session, key or deployment must be accounted for before using this record as the final cutoff.
