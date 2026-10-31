# Final Rehearsal Readiness Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` for the shared implementation; independent UI/document tasks may run in parallel. Independently review the whole branch before shipping.

**Goal:** Prepare a representative, observable final test on 1 November, 16:00–18:00 Qatar.

**Architecture:** Preserve the shipping full-snapshot and durable-outbox contracts. Share notification policy between the production transport and the simulated rehearsal, validate workflow prerequisites, and report unresolved work without hiding it.

**Tech Stack:** TypeScript, Next.js/React, IndexedDB, PostgreSQL 17, existing Node test runner and Chromium.

**Spec:** `docs/superpowers/specs/2026-10-31-final-rehearsal-design.md`.

## Global constraints

- Existing 110-device / 19-committee / 30-minute gate and thresholds are unchanged.
- No new dependencies, hosted migration, production change or hosted load during preparation.
- No automatic conflict dismissal or changes to accepted mutation semantics.
- Use existing brand tokens and preserve the 31 October failed evidence.

## Review focus

- Own notifications arrive before, during or after write confirmation; only confirmed/acknowledged own ids suppress reads.
- A foreign notification mixed into an own-echo window still refreshes, including Executive Chair windows.
- Reused fixtures lack a Draft or actionable support workflow; refuse before timed traffic and report the committee.
- A conflict blocks later intent: retain the entire queue and give the operator enough non-secret evidence to explain it.
- Long country names, keyboard focus and zoom must not turn larger controls into overflowing layouts.

## Tasks

- [x] **1. Establish baseline.** Attempt the full baseline, record the environment failure, establish the protected PostgreSQL 17 baseline and verify the final full suite; keep those results distinct.
- [x] **2. Repair rehearsal fidelity.** Add failing adapter tests for role refresh gaps, own/foreign notifications, metadata attribution and clock forwarding. Implement shared notification scheduling and transport subscription lifecycle; run existing Realtime/outbox tests and rehearsal typecheck.
- [x] **3. Make workflow fixtures repeatable.** Add failing tests for Draft budgeting and depleted-stage refusal. Generate adequate deterministic workflow reserves for the planned stage sequence and add read-only stage preflight. Preserve public burst timings and keep fixture changes explicit in the run packet.
- [x] **4. Make failures explainable.** Add bounded, redacted conflict/pending summaries and missing-work diagnostics. Test that retained conflicts cannot obtain PASS and that diagnostics expose no command payloads, tokens or contact data.
- [x] **5. Targeted UI pass.** Enlarge remaining dense Chair controls and normalise shared spacing. Check desktop/mobile, keyboard, reduced motion and browser zoom; update the visual checklist with actual evidence.
- [x] **6. Reconcile documentation and architecture options.** Correct completed session/backlog claims. Record delta-read and queue-epoch designs, risks and triggers without implying either is implemented.
- [x] **7. Write the final run packet.** Exact candidate/schema checks, fresh fixture sequence, token lifetime, named roles, timed ramp/H3, real-browser checks, original thresholds, evidence and retirement. Record the owner-selected window.
- [x] **8. Verify and independently review.** App/rehearsal typechecks, lint, full PG17 suite, grants check, build, local browser rehearsal and focused regressions. Review the exact final tree, repair findings and leave a concrete remaining human checklist.

## Execution ledger

- 31 October: reused attached `offline-demo-rehearsal` worktree; branch `codex/final-rehearsal-readiness` starts at `682ab47`. Baseline PG17 run started before implementation.
- Owner confirmed 1 November, 16:00–18:00 Qatar. No hosted traffic started.
- The first full baseline attempt was interrupted after the former local PostgreSQL process was found stopped; its failures remain in `/tmp/munos-final-readiness/baseline.log`. A fresh loopback PostgreSQL 17.11 instance passed the 102-test grants/privilege/native authorisation baseline (4,100 matrix cells).
- New fidelity tests failed on missing own-echo suppression, dropped support refresh gaps and lost intent attribution; the Draft reserve test failed with 19 instead of 76 Drafts. After fixes, 62 focused tests pass. The existing-conflict read regression failed with 2 reads before the one-read fix.
- Shared notification and repository lifecycle changes are announced protected sync work. No schema, grant or migration changed. Final full-suite/build/grants/browser checks and independent review are in progress.

- Final local verification: 993 tests passed, 0 failed, 0 skipped on disposable PostgreSQL 17.11; app/rehearsal typechecks, zero-warning lint, build and grants/policy checks passed. Demo Chromium S0–S9: 30 assertions passed, 7 hosted-only assertions skipped. Independent review: no actionable findings, plus 31 independently rerun focused tests passed.
- Final operator packet: [1 November watched run](../../FINAL_TEST_RUN_2026-11-01.md). Hosted target/configuration, identities, fixtures, Small, watcher GO, capacity and connected-browser checks remain operational prerequisites; no hosted test or production change occurred in this preparation.
- Owner explicitly requested opening and merging the completed PR. Publish only after independent review and green PR checks; record the resulting candidate SHA for the watched run.
