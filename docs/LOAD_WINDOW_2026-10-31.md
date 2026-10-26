# DCMUN load run — 31 October 2026

**PREPARED; NOT RUN.** Owner window “4–6” is interpreted as **16:00–18:00 Qatar / 13:00–15:00 UTC**. No timer, automation, paid upgrade, fixture application or hosted workload was started by preparing this card. Exact candidate, operator/watcher, preflight evidence and GO are recorded before traffic. The full [execution packet](LOAD_TEST_EXECUTION_PACKET.md) supplies guards, thresholds, fixture preparation and revoke-only cleanup.

## Population

| Role | Owner-reported maximum | Full test |
| --- | ---: | ---: |
| Chairs | 57 | 75 |
| Approval | 20 | 20 |
| Printing / Admins | 10 | 10 |
| Executives | 5 | 5 |
| Total staff devices | 92 | 110 |

The extra 18 Chair devices provide headroom. All 19 committees remain required. The delegate roster fixture stays an **approximate 420**, separate from **150 public QR visitors and 16 planned submissions**. Delegates do not sign into staff workspaces or create Auth sessions.

Use `--staff-profile dcmun-2026` in every command. Its 92-device diagnostic exactly matches 57/20/10/5, but cannot clear the 110-device gate. The historical default remains 77/11/11/11 at 110 and fails current role coverage. Reports preserve the selected profile and per-stage counts. Support roles share one scoped identity each in this harness; real multi-user Auth/Realtime/venue evidence remains separate.

## Before 16:00 or before starting traffic

- Owner confirms Small is healthy in the same project; no disk/add-on changes are implied. Pro is already confirmed. The owner reports Micro, next renewal 20 November, latest successful daily backup 25 October 23:26:28 UTC, PITR off and anonymous limit 30/hour. Recheck current backup/compute/limit state on the day. No new backup add-on spending is authorized by this card.
- Freeze and independently review the exact tooling/app revision. CI, native PostgreSQL tests, typechecks, lint, build and grants check must pass. The deployment must report the intended revision and Preview environment with working server-only key. Record the exact target ref, current preproduction marker and source/deployment identities.
- Prepare/refresh the 19 Chair + 3 support identities near the run, paced within the Auth quota. Prepare-session adds at most one identity. Avoid unrelated sign-ins from the same IP during preparation. No new sign-ins occur during the workload itself.
- Apply only approved, fresh isolated fixtures A and B as directed by the execution packet; obtain a valid resolution link for B/GA1. Confirm `.env.local` and shell precedence, protected conference IDs, live lifecycle status and the original-conference fingerprints. The owner-review conference `ac63e049-b89d-40c6-88a4-f635dd6fad80` is not a load fixture; retain it separately in the protected/retirement inventory.
- Dashboard watcher: **confirm before GO**. Operator, watcher and STOP communication channel: **record before GO**. The owner currently has sole site access; Chairs are scheduled for 4 November. Do not enter real data or alter Production during rehearsal.

## Window and commands

Suggested times reserve recovery/review rather than promising completion. Each ramp is a separate invocation; record GO before continuing. If preparation or a stage runs late, stop or revise the plan with the owner. **Do not start H3 after 17:10 Qatar**, skip a failed stage, silently extend beyond 18:00, or run an unapproved contingency test.

| Qatar | Step |
| --- | --- |
| 16:00–16:10 | Final target/configuration/Small/backup/fixture/watcher checks |
| 16:10–16:20 | S0: 10 staff, five minutes, bounded drain, manual settle/GO |
| 16:20–16:30 | R1: 25 staff, same sequence |
| 16:30–16:40 | R2: 50 staff, same sequence |
| 16:40–16:50 | R3: 80 staff, settle/GO and fresh B setup |
| 16:50–17:22 | H3: 110 staff + public burst, 30 minutes plus up to two-minute drain |
| 17:22–18:00 | Recovery observation, separate approved browser/Realtime/voting checks if time permits, evidence review and fixture retirement |

Private shell variables `PREVIEW`, `A`, `B` and `SUBMIT_TOKEN` are set by the operator from reviewed inputs. They are not pasted into reports or chat. Nothing here sets a default hosted target.

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" --fixture "$A/fixture.json" \
  --staff-profile dcmun-2026 --staff 10 --minutes 5
```

Repeat separately for `--staff 25`, `50`, then `80`, with manual settle/GO after each. Their mixes are 6/2/1/1, 16/5/3/1, 31/11/5/3 and 50/17/9/4. Ramps need `diagnosticVerdict.pass=true` and clean operator checks. Expected incomplete full-capacity labels are not failures of an otherwise healthy warm-up. Missing configured device/role/committee work, unexpected committee traffic, conflicts, local refusals or unsettled work are failures.

```bash
npm run rehearsal:run -- --app "$PREVIEW" --identities "$B/identities.json" --fixture "$B/fixture.json" \
  --staff-profile dcmun-2026 --staff 110 --minutes 30 --delegates 150 --delegate-window 120 \
  --submit-token "$SUBMIT_TOKEN" --submit-committee GA1 --submit-fraction 0.08
```

Before requests, confirm the printed mix **75/20/10/5** and **150 pages / 16 submissions**. At default seed 42, pages are scheduled 0.176–119.793 seconds and creates 57.292–282.470 seconds into H3. These are scheduled human steps, not guaranteed accepted traffic or RPC/capacity predictions.

H3 passes only with `conferenceGate.pass=true`, all configured devices successfully opened, accepted Chair traffic in all 19 committees, required role/action/public coverage, zero pending/conflicting/unconfirmed work, exactly-once checks and latency/error thresholds. The operator additionally checks CPU/IO/connections/logs, original-conference isolation and recovery. An exit code of zero or a diagnostic pass alone never proves readiness.

Real Realtime delivery remains simulated in the harness, and physical-device/browser/venue evidence remains separate. The owner's earlier Google Doc and two-laptop checks were reported successful; network/browser/editing details are not specified. This card does not waive remaining release evidence.

After each fixture's last stage, use only its reviewed revoke-only cleanup and verify no active fixture authority remains. Keep the shared identity pool until all approved runs finish. Final destructive cleanup, full credential/Preview/connector retirement, token wait, registry transition, release sign-off and production Executive bootstrap remain human cutover steps. PITR being off is recorded state, not approval of an acceptable data-loss window. No version, tag or Production configuration changes belong to this run.
