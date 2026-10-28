# Independent review of the 31 October run card — 28 October 2026

Reviewed: [LOAD_WINDOW_2026-10-31.md](LOAD_WINDOW_2026-10-31.md) (the run card) against [LOAD_TEST_EXECUTION_PACKET.md](LOAD_TEST_EXECUTION_PACKET.md), [PRECUTOVER_VERIFICATION_2026-10-26.md](PRECUTOVER_VERIFICATION_2026-10-26.md), [LIFECYCLE_CONTROLS.md](LIFECYCLE_CONTROLS.md) and the code on `origin/main` `d2e9e0c` (`scripts/rehearsal-run.mts`, `scripts/rehearsal/{scenario,readiness,identities,guard,fixture,metrics,identity-pool}.ts`, `scripts/rehearsal-{identities,fixture,snapshots,plan}.mts`, `scripts/prepare-session.mts`, `scripts/remote-context.mts`).

**Method and limits.** Everything below was read from the repository or computed by running offline code (`buildScenario`, `summarize`, `conferenceGateProfile`, `checkSingleLinkSubmissions`, `npm run rehearsal:plan`, the packet's P3 target-guard one-liner against a stand-in `.env.local`). No hosted Supabase or Vercel contact, no fixtures, identities or load run. **The owner's card was not edited.** Each item gives where, what the card says, what the code or packet does, and a proposed correction. Statuses: **Verified** = read in code or reproduced locally; **Untested** = needs the hosted project, a dashboard or a person.

## 1. What checked out (Verified)

1. **Every flag exists and is spelled as the runner expects**: `--app`, `--identities`, `--fixture`, `--staff-profile`, `--staff`, `--minutes`, `--delegates`, `--delegate-window`, `--submit-token`, `--submit-committee`, `--submit-fraction` (`scripts/rehearsal-run.mts` lines 29-66, 128). `npm run rehearsal:run -- <flags>` maps to `tsx scripts/rehearsal-run.mts`. `--stages` is correctly not used (it would evaluate once over all stages). Omitting `--staff-profile` silently selects `legacy`, so the profile flag must be in every command, as the card says.
2. **Stage mixes** (Chair/Approval/Admins/Executive, `dcmun-2026`): 10 staff 6/2/1/1; 25 16/5/3/1; 50 31/11/5/3; 80 50/17/9/4; 92 57/20/10/5; 110 75/20/10/5. The legacy profile gives 7/1/1/1, 16/3/3/3, 35/5/5/5, 56/8/8/8, 65/9/9/9, 77/11/11/11.
3. **H3 public burst** (110 staff, `dcmun-2026`, 19 committees, 30 min, 150 delegates, window 120 s, start window 150 s, fraction 0.08, seed 42): 150 page loads between **0.176 s and 119.793 s**; **16** submissions between **57.292 s and 282.470 s**; `checkSingleLinkSubmissions` ok (16 of a maximum 18). The runner prints `Stage 110 staff: 150 public page loads, 16 resolution submissions planned on one link (max 18).` and, just before, `{"staffProfile":"dcmun-2026","staffRolesPerStage":[{"chair":75,"approval":20,"admins":10,"executive":5}]}`. Fraction 0.05 gives 10; 0.10 gives 18.
4. **Gate claims.** `conferenceGateProfile` for 92 devices: eligible = false, failing only "at least 110 staff devices" (92 is 57/20/10/5 and passes the role-coverage check; it also plans 18 submissions at 0.08). For 110 with the `legacy` profile (77/11/11/11): eligible = false, failing only the role-coverage check. For 110 `dcmun-2026`: eligible = true. `diagnosticVerdict` (= `rampVerdict`) and `conferenceGate` both exist in the report; the exit code follows `conferenceGate.pass` when eligible and `diagnosticVerdict.pass` otherwise (`rehearsal-run.mts` line 374). The `readinessLabel` of any non-eligible run is `RAMP / DIAGNOSTIC ONLY`.
5. **Qatar 16:00-18:00 = 13:00-15:00 UTC** (UTC+3, no daylight saving). Five-minute stages and H3's 30 minutes plus a 120 s drain (`--drain-seconds` default 120, cap 600) are as the card says.
6. The P3 target-guard one-liner works when typed without the markdown escapes (`{"ok":true,"ref":"kllhswucdhqqywnzxado","shellUrlDiffers":false}`, exit 0).
7. Identity arithmetic: `rehearsal-identities --chairs 19` creates 19 Chair + 3 support = **22** anonymous sessions (cap 25 per run, 20 s pace, about 7 minutes); `prepare-session` signs in once only if `.test-sessions/development.json` is absent. 23 of the owner-reported 30 per IP per hour, so 7 spare.

## 2. Discrepancies and risks, most important first

### D1. HIGH: the protected-Preview bypass secret is missing from the card

- **Card** line 41: private shell variables are `PREVIEW`, `A`, `B`, `SUBMIT_TOKEN` only; nothing in the preflight list names it.
- **Code/packet**: the Preview is *protected* (pre-cutover record line 8: "Protected Preview ... temporary verification sharing was revoked"). The runner sends `x-vercel-protection-bypass` only if `VERCEL_AUTOMATION_BYPASS_SECRET` is in the environment (`rehearsal-run.mts` lines 34-36). Without it `/api/health` is not JSON (or redirects, which the runner refuses with `redirect: 'error'`), `health` becomes `null` and the run exits 2 with "Target did not return a Conference OS /api/health report" (lines 91-93). Packet P12 covers it; the card does not.
- **Failure mode**: safe (nothing is sent to Supabase beyond the guards), but it burns the first stage slot.
- **Correction**: add `VERCEL_AUTOMATION_BYPASS_SECRET` to the private-variable sentence and to the preflight (check `[ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ]`, never print it). The run sheet does.

### D2. HIGH: fixture B setup cannot fit in the R3 slot, and the card contradicts itself and the packet on when B exists

- **Card** line 24 ("Before 16:00") says to apply "fresh isolated fixtures A and B" and obtain the B/GA1 link beforehand. Card line 38 says the 16:40-16:50 slot holds "R3: 80 staff, settle/GO **and fresh B setup**". **Packet** §3.3 and §10.1 (rows 1-2) generate B "only when H3 is about to run", after fixture A's revoke-only cleanup.
- **What fits**: R3 alone is 5 min scenario + runner start-up (guards, 22 session loads, health, binding read) + up to 2 min drain + up to 30 s close + final read + the 2-minute settle (C13) = roughly 9 to 10 minutes. B setup (generate, review `fixture.sql`, Approver applies it, P6 check, P13 fingerprint, create the resolution link as the fixture Executive, export `SUBMIT_TOKEN`, plus A's cleanup and fingerprint) cannot also happen in 16:40-16:50. The link-creation procedure is documented as untested (packet §3.3 step 2).
- **Related**: the whole S0-R3 block is 4 x 10 = 40 minutes; the packet budgets "about 50 minutes" for S0-R3 with reviews and settles (§4.1, last paragraph).
- **Correction (proposed, owner decides)**: generate and apply B (`--grant-hours 4`) and create its GA1 link **before 16:00**, so the 16:40 slot is only R3, settle and GO; defer A's revoke-only cleanup and fingerprint to after H3 (A is idle and its 3-hour grants expire by themselves; revocation is the proof, not the urgency). Rewrite the 16:40 row to "R3, settle/GO" and the 17:22 row to "revoke-only cleanup of A and B". If the owner prefers the packet order, move H3 later or drop a ramp stage; either way record the choice.

### D3. HIGH (non-product failure): access tokens can expire during H3

- **Code**: `loadSession` refreshes a session file only if it has **less than 30 minutes** left (`scripts/rehearsal/identities.ts` line 62). The runner's clients use that bearer token for the whole run with `autoRefreshToken: false` (`rehearsal-run.mts` line 86). Access tokens last 3,600 s (LIFECYCLE_CONTROLS / pre-cutover: confirmed Auth setting). H3 needs a valid token for about 30 min + 1 s start + drain up to 2 min + close + the final Executive read, i.e. **up to about 33 minutes**.
- **Failure mode**: any pool session with between 30 and about 33 minutes of life at H3 start is *not* refreshed and expires at roughly 17:20-17:23, so the last minutes (and the final exactly-once read as Executive) return 401, raising the error rate above 1 %, or failing the settle/exactly-once checks. All 22 sessions are refreshed together at the first stage start that finds them under 30 minutes, so a refresh at R1 start (about 16:21) puts every expiry near 17:21 and H3 (about 16:51) sees 30 minutes left: exactly the unlucky case. Whether it happens depends on when the pool was last refreshed (Untested).
- **Correction**: immediately before H3 (and before S0) refresh all pool sessions: `npm run rehearsal:identities -- --chairs 19`. With the files present this makes **zero sign-ins** (22 refreshes, each preceded by the anonymous phase read), then every token has about 60 minutes. Alternatively change the threshold in code (owner/reviewer decision; not done here). The run sheet adds this as a preflight step with a time field.

### D4. MEDIUM: "verify no active fixture authority remains" is wider than the cleanup verify query

- **Card** line 62 and **packet** §10 say `cleanup.sql` revokes grants, submission links, amendment links and access credentials, "ends with a verify query expected to return 0".
- **Code**: `cleanupSql` (`scripts/rehearsal/fixture.ts` line 111) ends with a single comment-line query counting only `public.user_access` rows with `revoked_at is null`. The submission link (a public bearer token for fixture B), amendment links and `private.access_credentials` are updated but never counted.
- **Correction**: add three read-only counts to the post-cleanup checklist (the run sheet has them, built from the `cleanupSql` table and column names) or extend the generated verify comment in a reviewed code change. Note that Auth sessions of the pool identities are *not* touched by `cleanup.sql`; that is final retirement (see the run sheet, section 9).

### D5. MEDIUM: preflight gaps against the packet

The card's preflight bullets (lines 21-25) omit, relative to the packet:
1. **`scripts/prepare-session.mts` and its files** (packet P7). `remote-context.mts` reads `supabase/fixture-ids.json` (tracked) and `.test-sessions/development.json`; a missing file stops the runner with "Rehearsal setup missing" before any traffic. The card only says "Prepare-session adds at most one identity".
2. **Target guard command** (P3) and the lists check (P4): the card says "confirm `.env.local` and shell precedence" without the exact check or the expected `{"ok":true,...}`.
3. **Fixture generation parameters**: the card never states `--committees 19 --delegates 420 --grant-hours 3|4`. The `rehearsal-fixture` default is **14** committees; the scenario then plans a different number of public submissions (checked: 18 committees gives 10, 29 minutes gives 10, both below the gate's 16) and the gate's "19 real committees" check fails. The fixture command belongs in the card or the card must cite packet §3.2/§3.3.
4. **`PROTECTED_CONFERENCE_IDS`**: the card names the owner-review conference `ac63e049-b89d-40c6-88a4-f635dd6fad80` but not that it should be in the protected list; packet P5 lists only the 21 October temporary conference "and any other conference to protect". Add `ac63e049-...` (and the synthetic verification conference `a410008d-8d79-478c-9a08-341952f6af0a` if it still exists) to the protected list.
5. **Owner activity on the original conference during the window**: the card says the owner currently has sole site access. The packet's fingerprint query (C11, STOP 1) treats *any* change to the original conference as a stop. Ask the owner not to write to the original (or owner-review) conference from 16:00 to 18:00, or exclude it from the comparison by an agreed rule, otherwise a legitimate edit will look like STOP 1.
6. **The lifecycle `preproduction_status` read** is performed by every tool (`prepare-session`, `rehearsal-identities` before each sign-in or refresh, `rehearsal-run` after the local guards), but its value is not printed. The card says "record current preproduction marker" without a way; the run sheet records "tool accepted the marker" plus an optional manual read of the same anonymous RPC.
7. **Auth quota**: arithmetic holds (22 + 1 = 23 of 30), but the card says to prepare identities "near the run" while the packet says "the day before" (§3.1); the headroom is only 7 sign-ins and depends on no other anonymous sign-in from the same IP in the previous hour (the owner's browser tests included). Pick one time and record the count of sign-ins in the hour before.

### D6. MEDIUM-LOW: the timeline has no slack beyond its own arithmetic

- A 10-minute ramp slot holds 5 min + start-up + drain (up to 2 min) + close + final read + 2-minute settle = about 8.5 to 10 minutes. The packet's fallback ("one further 3 min, else stop", C13) and any C7-C12 or fingerprint (C11) reading do not fit, so any non-immediate settle consumes the next stage's slot. The card does say to stop or revise if late.
- H3 "16:50-17:22" assumes the command starts exactly at 16:50:00 with zero start-up. Realistic worst case is about 17:23-17:24.
- **"Do not start H3 after 17:10"** is consistent with the 18:00 hard stop for the *run* (17:10 + about 33 min = 17:43-17:44), but leaves only about 16 minutes for the packet's 10-minute recovery observation (H5), revoke-only cleanup, fingerprint and evidence, versus the 38 minutes the card plans at 17:22. If H5 and cleanup must finish by 18:00 the latest start is nearer 17:00-17:05. Suggest either moving the cut-off or stating that H5/cleanup shrink if H3 starts after 17:00.

### D7. LOW-MEDIUM: wording of the final row can be read as destructive cleanup

Card line 39 ("evidence review and fixture retirement") versus line 62 (destructive cleanup, credential/Preview/connector retirement and token wait are human cutover steps; the identity pool is kept until all approved runs finish) and packet §10.1/§14 item 7 (a 1 November contingency rerun may still be approved). Replace "fixture retirement" with "revoke-only cleanup of each fixture". The packet and card are otherwise consistent on cleanup ordering (per-fixture revoke only; pool, `development.json`, fixture folders and reports kept until the last approved run; fixture B generated from the same pool after A).

### D8. LOW: packet and plan documentation drift (no effect on the card's commands)

1. Packet Appendix A (lines 426-427) omits `--staff-profile` from the `rehearsal:run` and `rehearsal:plan` flag lists, though both accept it (`rehearsal-run.mts` line 40, `rehearsal-plan.mts` line 12).
2. Bare `npm run rehearsal:plan` does **not** reproduce the card: its defaults are `--committees 14` and `--submit-fraction 0.3`, and the legacy profile. Reproduce with `npm run rehearsal:plan -- --staff 110 --staff-profile dcmun-2026 --delegates 150 --minutes 30 --committees 19 --submit-fraction 0.08` (roles 75/20/10/5, 150 page loads), or the packet §6 `buildScenario` one-liner (both reproduced here; its estimator output is historical only).
3. The packet's P3 command is shown with `\|\|` (markdown table escaping). Copying the raw source instead of the rendered text breaks the JavaScript; unescaped it works.
4. `docs/LOAD_TEST_PLAN.md` still tabulates the old 7/1/1/1 ... 56/8/8/8 mixes and rate estimates (the packet states they are superseded). Anyone cross-reading the plan will see numbers that disagree with the card.
5. `tsconfig.rehearsal.json` (the CI type check of the entry points) includes only four scripts; `rehearsal-snapshots.mts` and `prepare-session.mts`, both used on the day, are not type-checked in CI. (The new `load-evidence-check.mts` was added to it.)

## 3. Things that could stop or spoil the run for a non-product reason

1. **D1 bypass secret** (refusal before load), **D3 token expiry** (mid-H3 401s), **D2 timeline** (stage slot overrun).
2. **Declared operations that never run.** `observedWorkVerdict` requires every action the scenario *schedules* (`speechScore`, `poiRecognize`, `poiScore`, `sendToApproval`, `approve`, `print`) to be accepted at least once, but a scheduled step is skipped when its precondition is false (no active speech in `pois` state, no actionable document owned by that device). Ramps share fixture A, so earlier stages leave speeches and documents in new states. A ramp can therefore fail the "declared critical operations were observed" check without a product fault; the packet's remedy is a fresh reviewed rerun, which the card forbids without owner approval (card line 29). Untested hosted.
3. **Operator machine as the bottleneck.** One Node process runs 110 simulated devices with in-memory IndexedDB plus 150 page loads; latency is measured client-side. A busy, sleeping, VPN-switching or Wi-Fi laptop inflates p95 (C4: 1,500 ms) or breaks the run. Use a wired, power-connected machine with sleep disabled, a single stable egress IP, a synchronised clock, and watch its CPU. All traffic comes from one IP: Vercel's platform protections and any Supabase network limits on a single source are Untested at this volume.
4. **Settle timing** (C13) depends on dashboard baselines that are not recorded anywhere unless the watcher logs them before S0.
5. **Seed sensitivity.** The 16-submission count is exact only for the documented flag set; changing minutes, committees or the start window changes the shared random stream (examples above). The card's instruction to stop if the printed count differs is correct.

## 4. What could not be verified locally

- Anything hosted: the Small compute state, backups/PITR, Auth limits, the Preview's health and protection state, the fixture SQL application, the link-creation procedure for B (packet §3.3: "how an operator signs the fixture's anonymous Executive identity into a browser is not documented"), real dashboard thresholds (Small connection limit of 90 is from the plan's cited public documentation).
- Whether the stage reports pass in practice (the actual-core runner has not run against the hosted project); whether session files in the pool are older than 30 minutes (D3).
- Real Realtime fan-out, physical-device offline behaviour, Google Doc access (all stated as separate gates in the card).

## 5. Test and tooling results

See the final report of this task; local results are not repeated here.
