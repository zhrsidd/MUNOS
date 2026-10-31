# Final watched test · 1 November 2026

**Owner-selected window: Sunday 1 November, 16:00–18:00 Qatar (13:00–15:00 UTC).** This is the next test, not a capacity PASS or production-promotion approval. The 31 October [NO-GO evidence](../evidence/load-2026-10-31/SUMMARY.md) remains valid. No hosted traffic was started while preparing this packet.

This packet updates the date, candidate and fixture reserves of the [reviewed run sheet](LOAD_RUN_SHEET_2026-10-31.md). Its unchanged preflight, isolation fingerprint, dashboard, STOP, evidence and retirement controls still apply. Do not reuse that sheet's completed historical results as today's checks. Use the commands below in place of its one-Draft fixture commands. The [release scope](RELEASE_SCOPE_2026-10-26.md), [lifecycle](INFRASTRUCTURE_LIFECYCLE.md) and [release checklist](V1_RELEASE_CHECKLIST.md) continue to control promotion.

## Candidate and ownership

- Record the merged PR, full source SHA, tooling SHA, Preview deployment ID and database ledger in `evidence/load-2026-11-01/preflight/preflight-record.md`. CI and independent protected-area review must cover the candidate. This branch adds no migration; the expected ledger remains the 37 migrations through `20261101090000_snapshot_committee_prefilter`.
- The candidate includes #93's snapshot prefilters, #94's own-echo suppression and support refresh interval, the shared production/rehearsal notification scheduler, the existing-conflict duplicate-read fix and the UI pass. These improvements have not yet passed a watched hosted capacity run.
- **Zuhayr Siddique** owns fixture-application approval, dashboard watching, GO/NO-GO and STOP authority. The operator executes; it does not waive a failed gate. John Paul Ribeiru remains the release approver. The independent reviewer is separate from the implementer.
- Use the existing single hosted project while its lifecycle still permits synthetic testing. No real conference data, Production target, additional project, paid branch or production configuration change is part of this test. The approved direct RPC scope remains in force.

## Before 16:00: complete preparation

1. Confirm a **connected, protected Preview of the exact merged candidate**. A Ready deployment or successful `/api/health` alone is insufficient: check Preview environment, source SHA, server health and client bundle project/conference binding. The normal demo Preview does not count. Use the verification procedure in [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md); record all target identities. Do not change Production for this test.
2. Recheck the hosted lifecycle, migration ledger, grant checks, original-conference fingerprint and absence of real data. Confirm **Pro + Small**, no resize/restart in progress, actual connection limit, backup time and PITR state. PITR was off in the earlier record; do not claim it is on or silently add spending. Synthetic-only risk acceptance is distinct from a production backup decision.
3. Restore the approved private operator environment and existing identity pool. This worktree has no `.env.local` or private sessions. Keep server keys, bypass secrets, staff codes and public submission tokens out of evidence and chat. Run the local target preflight from the reviewed sheet; reject a conflicting shell/file target. Both target guard and lifecycle checks must pass.
4. Use the existing **22 role identities** (19 Chair + Approval + Printing + Executive), not 110 new Auth users. At the recorded anonymous limit of 30/hour, creation of 22 plus the one preparation identity already uses 23; inspect recent usage first. Refresh existing identities within five minutes before S0 and again before H3. Confirm sufficient remaining token lifetime; configured access-token lifetime is 3,600 seconds. Do not count a failed/partial identity preparation as ready.
5. Generate **two fresh fixtures**, A for the four ramp stages and B for H3, with four Drafts per committee. Review their SQL and protected-conference exclusions, then obtain the owner's GO to apply each. Do not reset or rewrite an already used fixture to obtain PASS.

```bash
# Local generation only; run twice and record each distinct output directory.
npx tsx scripts/rehearsal-fixture.mts \
  --identities .test-sessions/rehearsal-multi-identities.json \
  --committees 19 --delegates 420 --grant-hours 4 --drafts-per-committee 4
```

Set private shell variables `A` and `B` to the two generated directories, not just their conference UUIDs. Each must contain `fixture.sql`, `cleanup.sql`, `fixture.json` and `identities.json`. Each fresh fixture has **133 documents: 76 Drafts, 19 Review, 19 Approved and 19 In Debate**, with 19 committees and 420 delegates. This is a larger document payload than the previous 76-document fixture; record that difference when comparing performance.

The deterministic seed-42 ramp consumes up to four Drafts in one committee across S0/R1/R2/R3; H3 independently needs up to four. The runner now checks scoped snapshots and remaining Draft/support workflow before each timed stage and refuses a depleted fixture. This check does not guarantee every future action succeeds: actual observed work and all zero-unresolved checks remain required.

```bash
# Local planning only. Estimates printed alongside these plans are historical comparisons.
npm run rehearsal:plan -- --staff-profile dcmun-2026 --staff 80 --minutes 5 \
  --committees 19 --draft-stages 10,25,50,80
npm run rehearsal:plan -- --staff-profile dcmun-2026 --staff 110 --minutes 30 \
  --committees 19 --delegates 150 --delegate-window 120 --submit-fraction 0.08
```

6. Create and verify B's GA1 public resolution link through the approved Preview workflow. Keep `SUBMIT_TOKEN` in the private shell only. Verify the runner's exact link binding and planned **150 page loads / 16 creations**, not a fake QR path. The 420 figure is the seeded roster, not 420 simultaneous authenticated devices.
7. Complete the read-only payload probe and save per-role results before the timed window. Prepare a separate small synthetic browser fixture/Preview if needed; the offline hosted browser helper has additional isolation guards and must not be pointed at a 19-committee load fixture by casually raising its safety limit.
8. Open Supabase and Vercel dashboards, verify the stop channel and operator machine/network, and record idle baselines. Make the two fixtures and QR workflow ready before the window, so setup does not consume H3 time. No timed traffic starts without the owner's written GO naming the candidate and this packet.

## Watched sequence

Suggested slots include drain, two-minute settle and a manual GO decision. Never chain the commands, use a multi-stage invocation or continue after NO-GO. If a stage needs longer, revise the schedule with the owner; do not shorten the 30-minute H3 or bypass checks. **Latest H3 start: 17:10 Qatar; hard stop: 18:00.**

| Qatar | UTC | Work |
| --- | --- | --- |
| 16:00–16:10 | 13:00–13:10 | Final target, Small, fixture, health, token and dashboard GO |
| 16:10–16:20 | 13:10–13:20 | S0: 10 staff / 5 minutes on A, drain, settle, decision |
| 16:20–16:30 | 13:20–13:30 | R1: 25 staff / 5 minutes on A, drain, settle, decision |
| 16:30–16:40 | 13:30–13:40 | R2: 50 staff / 5 minutes on A, drain, settle, decision |
| 16:40–16:50 | 13:40–13:50 | R3: 80 staff / 5 minutes on A, drain, settle, decision |
| 16:50–17:25 | 13:50–14:25 | Refresh identities, H3 on fresh B: 110 staff / 30 minutes, bounded drain |
| 17:25–17:40 | 14:25–14:40 | Ten-minute recovery observation, evidence and fingerprint comparison |
| 17:40–18:00 | 14:40–15:00 | Remaining functional checks if feasible; decision and per-fixture revocation |

```bash
# S0. After PASS, settle and explicit owner GO, enter the next command separately.
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" \
  --fixture "$A/fixture.json" --staff-profile dcmun-2026 --staff 10 --minutes 5

# R1, only after S0 GO.
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" \
  --fixture "$A/fixture.json" --staff-profile dcmun-2026 --staff 25 --minutes 5

# R2, only after R1 GO.
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" \
  --fixture "$A/fixture.json" --staff-profile dcmun-2026 --staff 50 --minutes 5

# R3, only after R2 GO.
npm run rehearsal:run -- --app "$PREVIEW" --identities "$A/identities.json" \
  --fixture "$A/fixture.json" --staff-profile dcmun-2026 --staff 80 --minutes 5

# H3, only after R3 GO and the refreshed tokens / fresh B checks.
npm run rehearsal:run -- --app "$PREVIEW" --identities "$B/identities.json" \
  --fixture "$B/fixture.json" --staff-profile dcmun-2026 --staff 110 --minutes 30 \
  --delegates 150 --delegate-window 120 --submit-token "$SUBMIT_TOKEN" \
  --submit-committee GA1 --submit-fraction 0.08
```

H3 must configure and observe **75 Chairs / 20 Approval / 10 Printing / 5 Executives**, all 19 committees, the required write families and the unchanged public workload. Realtime delivery in the capacity runner is **simulated**, using the shared production scheduling policy; it does not prove real channel delivery or venue networking.

## Acceptance and STOP

Every original [run-sheet threshold and STOP rule](LOAD_RUN_SHEET_2026-10-31.md#6-stop-thresholds-the-watcher-calls-stop-all-manual-packet-7) remains in force. In particular:

- Worst per-action write p95 ≤1,500 ms; read p95 ≤2,500 ms; runner error rate <1%; no rate limiting; zero unexplained database/API/Vercel errors. Keep the public-path thresholds from the original sheet too.
- Zero duplicates, lost acknowledgements, pending, conflicts and unconfirmed work at close; no close timeout; all declared work observed. The new `unresolved` summary shows bounded command types/states/reason categories for diagnosis. It does not relax a failed verdict. Never discard, rebase or hide work to manufacture PASS.
- CPU average <70%, no five-minute window >85%; **STOP above 90% for two consecutive minutes**, and apply the sheet's other immediate STOP rules. Connections stay below 75% of the verified limit; memory/IO and original-conference fingerprints remain healthy.
- Only a qualifying H3 with `conferenceGate.pass`, a READINESS RUN label, complete evidence and all operator checks can satisfy the capacity gate. A diagnostic continuation after NO-GO cannot do so. A local test, isolated SQL profile or demo browser rehearsal cannot substitute for it.

On STOP, interrupt the runner immediately, verify the rehearsal process has ended, preserve logs and revoke the affected fixture's grants/links through its reviewed `cleanup.sql`. Do not restart on the consumed fixture. Any revised run needs its own explicit scope/GO decision.

## Functional checks, evidence and cutover boundary

Complete real connected-browser checks on the exact candidate: two Chairs across a disconnect/reload and reconnect, real foreign Realtime updates, roll-call draft/commit/correction, immutable ballot eligibility, speech/POI/points, Approval feedback/history, printing, public resolution/amendment access and revocation. Preserve the existing rollback drill on preproduction. Report individual unverified checks; time running out does not make them pass.

Holding stays **off** for A/B. Test hold/review separately on a scheduled synthetic fixture with the configured two-minute trust and five-minute staleness defaults. A successful ordinary-path load cannot establish holding-enabled performance or correctness. Delta reads and automatic queue clearing remain [documented follow-ups](PERFORMANCE_FOLLOWUPS_2026-10-31.md), not implemented features.

Create `evidence/load-2026-11-01` using the original sheet's evidence structure, with commands using placeholders, sample-free reports (`jq 'del(.samples)'`), dashboard rows/screenshots, fingerprints, incidents, GO/NO-GO decisions and revoke verification. Keep raw reports/identity files private. Run `npm run check:load-evidence -- evidence/load-2026-11-01` and manually inspect the files before publishing; `--allow-incomplete` is for preparation only.

Revoke each fixture after its last approved use. **Final retirement waits for every approved rerun and saved evidence.** Production promotion, protected cleanup, credential/grant/session revocation, the confirmed **3,600-second** token wait, connector retirement and release approval remain separate human-controlled cutover steps. Merging this preparation PR neither connects Production nor completes cutover.

## Owner's short checklist

1. Before 16:00, confirm Small, a connected Preview of the merged candidate, the private operator environment and two approved fresh fixtures.
2. At 16:00, be available here with the Supabase/Vercel dashboards. Give GO after the preflight record is complete; call STOP when a threshold is crossed.
3. Decide GO after each ramp stage. After the run, review the capacity/functional verdict before scheduling production cutover. Keep 2 November for fixes; the existing 3 November freeze is unchanged.

## Preparation verification

The preparation branch was independently reviewed with no actionable findings. Local verification: **993 tests passed, zero failures/skips**, using disposable PostgreSQL 17.11 (including 4,100 authorisation matrix cells); app and rehearsal typechecks, lint, production build and generated-grants/policy checks passed. The independent reviewer additionally ran 31 focused tests. Chromium's demo offline rehearsal passed 30 assertions; seven hosted-only checks were skipped. The [UI evidence](design/rehearsal-ui/README.md) records mobile/desktop, keyboard, reduced-motion and actual 200% browser zoom checks. These results establish local preparation, not hosted capacity or release readiness. CI must still pass on the PR head before merge and the resulting candidate must be recorded for the watched run.
