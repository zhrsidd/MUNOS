# Pre-flight record, load window 31 Oct 2026 (operator: Claude; decider/approver/watcher: Zuhayr Siddique)

Redone from scratch in the cloud operator session. No secret values recorded.

| ID | Result | Detail |
| --- | --- | --- |
| PF2 | PASS (merge commit CI not found, local run at the SHA passed) | HEAD `288c7236059bafe6bb2b16e860fdcdcca19f5d31`; `npm ci` ok; typecheck, typecheck:rehearsal, lint, check:grants exit 0; `npm test` 960 pass / 0 fail / 0 skipped on local PostgreSQL 17.11 (loopback, disposable) |
| PF3 | PASS | `/api/health`: status ok, environment `preview`, commit `288c723…`, deployment `dpl_2UYk8wYf7zyudbDjetsbuCv3gBTR`, branch `codex/preproduction-connected`; Supabase, database, storage `ok`. Vercel record: state READY, target null, same commit SHA. Preview `munos-jij0int7d-dcmun.vercel.app` |
| PF4 | PASS | `target-guard.json`: ok true, ref `kllhswucdhqqywnzxado`, shellUrlDiffers false, exit 0 |
| PF5 | PASS | `EXPECTED_SUPABASE_REF` unset; ref in `STAGING_SUPABASE_REFS` only (`DEVELOPMENT_SUPABASE_REFS` unset); `NEXT_PUBLIC_CONFERENCE_ID` 0331ceb6-3fa8-4731-92cb-2b4c0316d0cb; `PROTECTED_CONFERENCE_IDS` = 5 UUIDs (owner list, 31 Oct): 0331ceb6-…, 5d9f8e82-…, e3a38dc2-…, a410008d-…, ac63e049-… |
| PF6 | set | bypass secret present in shell only |
| PF9 | PARTIAL | Supabase auth logs: 0 `/signup` calls in the last 24 h before PF11. Planned total 23 (1 + 22). Dashboard limit (card: 30/h) not readable by the operator: owner to confirm |
| PF10 | PASS (accepted) | `preproduction_status`: phase preproduction, canTest true, revision 1, ref `kllhswucdhqqywnzxado` |
| PF11 | PASS | `supabase/fixture-ids.json` present; `prepare-session` output project `kllhswucdhqqywnzxado` |
| PF12 | PASS | `rehearsal:identities --chairs 19`: created 22, refreshed 0, pendingNextRun 0, exit 0. Anonymous sign-ins this hour: 23 of 30 (pool 22 + prepare-session 1) |
| PF19 | PASS | roles 75/20/10/5, pageLoads/submitPage 150, submit 16, staffApp.writes 2840, max 2.8 per user per minute (`plan-h3.json`) |
| PF24 | PASS | `check:load-evidence --allow-incomplete` exit 0, 0 findings |

Environment note: `.env.local` was created in the working tree (git-ignored) from the shell's public configuration only (URL, publishable key, conference id, timezone, staging ref). No secret key is stored.
| PF3b | PASS | `migrations.txt`: all 7 session-model migrations present |
| PF3c | PASS | `private.conference_settings`: no row with hold_enforcement true, none for the original or fixture A conference |
| PF7 | Small, confirmed by owner 31 Oct | not verified on the dashboard by the operator |
| PF8 | synthetic data only, owner accepts | |
| PF13 | PASS | fixture A conference `573cfbeb-d3ed-4cf5-b418-7d36326f69c8`: readinessFixture true, committees 19, chairGrants 19, distinctChairUsers 19, delegates 420, grantHours 3 |
| PF14 | PASS | see `fixture-A-review.md`; UUID differs from all 5 protected ids |
| PF15 | PASS (baseline) | `fingerprint-before.txt`, `advisors-before.txt` (read-only, Supabase connector) |
| PF22 | not applicable | operator is a cloud session |
| PF16 | PASS | fixture A applied by the Approver in the SQL editor (sha256 of fixture.sql e8ccc424…bd90). Operator re-verified read-only at 12:10 UTC: 1/19/19/420/19/420/76/76/76/1 rows, 22 grants all active, expiry 2026-10-31 15:06:46 UTC (after R3 end ~13:50 and the 15:00 hard stop); original-conference fingerprint identical to `fingerprint-before.txt` |
| PF17 | PASS | `payload-snapshots.json` 12:11:58-12:15:01 UTC after a refresh (0 created, 22 refreshed): 22 roles (19 chair, approval, admins, executive), failures 0 everywhere. Chair ~14.3 KB, p50 ~365-400 ms, worst chair p95 912 ms; approval/admins ~59 KB, p95 ≤ 566 ms; executive 229,581 B, p50 1,035 ms, p95 1,101 ms. Fingerprint re-read after the probe: unchanged |
| PF18 (partial) | generated and reviewed locally | fixture B conference `1e6bb11f-95c2-4acc-9849-2047818cbdd4` (differs from A and the 5 protected ids), grantHours 4; see `fixture-B-review.md`. NOT yet applied; submission link and SUBMIT_TOKEN pending |
| PF18 (fixture B applied) | PASS (applied by the Approver; operator verified read-only 12:18 UTC) | counts 1/19/19/420/19/420/76/76/76/1, 22 grants all active, expiry 2026-10-31 16:17:25 UTC; fixture A still 22 active grants; B has 0 submission links so far; original-conference fingerprint identical to `fingerprint-before.txt`. Link and SUBMIT_TOKEN still pending |
| PF18 (link) | PASS | one GA1 submission link created on fixture B 1e6bb11f-… at ~12:25 UTC by the operator as the fixture Executive through the app's own transport (SupabaseTransport + newSubmissionToken + operationsFingerprint), after the Executive snapshot confirmed conference B and 19 committees. DB check: 1 active link on B, bound to GA1; original-conference fingerprint unchanged (24/last 2026-10-25 23:43:50/11/1/2/30). `GET /submit/<token>` on the Preview returned HTTP 200 (page content not asserted). `SUBMIT_TOKEN` is held in a 0600 file under `.test-sessions/` and loaded into the shell per command; value never printed or recorded. The Executive-binding check is done by the runner before delegate traffic |
