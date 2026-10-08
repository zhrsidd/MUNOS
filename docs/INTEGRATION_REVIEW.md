# Conference OS integration review and handoff

> **Historical checkpoint (6 October 2026).** Since then staff access codes (PR #12/#13), central sessions and the amendment QR workflow (PR #13), staff batch hardening (PR #14) and System health in every staff workspace, available offline (PR #15/#16) have landed; items below described as deferred for those features are out of date. Current operations: [CONFERENCE_RUNBOOK.md](../CONFERENCE_RUNBOOK.md); release gates: [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).

**Checkpoint: 6 October 2026. Development only.** Latest update: the server key is configured and real public submission HTTP/browser verification passed; see the newest evidence below. This integrates the reviewed five-PR operations stack with core conference procedure. It does not certify conference readiness or record completed GitHub merges. PR **#6 must stay draft and unmerged**.

## Product decisions implemented

- Staff workspaces: Chair, Approval, **Admins** and **Executive**; internal roles/routes stay compatible.
- Google Docs remains the resolution editor. QR submissions enter Draft for Chair review, then the existing approval/printing/debate/voting lifecycle. No parser, clause editor or automatic amendment application was added.
- Delegates use only the isolated server-mediated QR form, without Supabase Auth sessions or staff app access.
- Preferred sharing: **Anyone with the link → Editor**. If restricted, use actual assigned Chair names/contact emails. Confirmation: **“I have made sure the Chairs can edit this document.”** Legacy `share_with` is not authoritative; optional staff email is contact metadata, not an identity or access grant. The additive contact migration is applied and verified: browser save/reload persisted, the server-only lookup returned the assigned contact, and the temporary test email was cleared. Future Drive automation has separate credentials.
- Shared current session is explicit and authoritative. Open/for/against speaker queues and POIs are independent; ordering survives reload. POIs create participation only when recognized/scored. Speech classification, once-only Main-Submitter credit and one-hop yield to Co-Submitter preserve context.
- Divide the House excludes abstention. Configured SC permanent-member IDs can veto substantive votes; procedural votes are exempt. Award rubric controls are retired; human Chairs decide awards using factual, alphabetical participation context.

## Review and evidence

| Area | Evidence / status |
| --- | --- |
| Claude PRs 1–5 | Reviewed at heads recorded in [CLAUDE_REVIEW.md](CLAUDE_REVIEW.md); integration fixes address lifecycle visibility, payload-bound replay, ambiguous upload recovery and stale mutation protection. |
| Development schema | Applied through `20261006073442_staff_chair_contacts` exactly once; remote types regenerated. 31 public RLS tables; 32 authenticated public relations with SELECT only, no anonymous grants; service-only contact lookup. Preserve the migration ledger. |
| Remote workflow | [Recorded Data API/SQL result](remote-integration-results.json): Draft through closed vote, POI idempotency, speech/yield, queues, schedule, photo acknowledgements and fresh reads passed. |
| RLS and local correctness | Remote rollback allow/deny tests passed; latest reported local suite 68 passing. Final typecheck/lint and 68 tests passed after the reliability fix; final production build passed. |
| Browser | Staff role screens and actions exercised; two Chair identities and shared-session updates observed. Final-build recovery/mobile evidence still needed. |
| Public submission boundary | Code isolates delegates from staff authentication; service-only SQL tested. Real HTTP/file-upload test blocked by absent server development secret. |
| Advisors | 34 security warnings: 33 anonymous staff-bootstrap policy warnings plus password protection. Performance: 69 unused-index INFO findings, no warnings/errors. |
| Load | 150 staff clients using one identity: zero errors/duplicates, 150 reconnects; burst-read p95 13.093 seconds. QR bursts and school-network distinct staff devices untested. |

## Acceptance gaps and next actions

1. Preserve the verified migration ledger; contact migration `20261006073442_staff_chair_contacts` is applied and must not be replayed. Final reliability checks passed.
2. Configure development `SUPABASE_SECRET_KEY` only in ignored server configuration. Test the real QR page and HTTP endpoint, confirm no delegate Auth requests, and exercise duplicate retries, revoked links, invalid documents and fallback upload failure/recovery.
3. Complete final typecheck/lint/test/build and browser desktop/mobile workflows, refresh persistence, two-Chair conflicts, offline close/reopen and exactly-once outbox recovery. Preserve/export unresolved pending changes.
4. Finish ordered PR integration with correct bases and a recorded resulting main commit after checks. The core branch is already pushed through `35f89be`; merges remain pending. Keep #6 draft; never force-push shared history.
5. Handoff to Claude for protected Preview/staging, separate staff/QR load rehearsals, Observability investigation of tail latency, monitoring and rollback drills. No production Supabase project exists; do not substitute local mode for remote acceptance.

Future Drive copies/snapshots, staff access-code UI, replacement-device hardening and digital amendment features remain deferred. Rare Google Doc `resourcekey` preservation is a low-priority follow-up. Detailed evidence and historical-load interpretation: [VERIFICATION.md](VERIFICATION.md).

## Requested 29-point report

| # | Requested item | Result and evidence boundary |
| --- | --- | --- |
| 1 | Each Claude PR | #1 deployment groundwork accepted, health probes bounded; #2 health/runbook accepted, access error wording corrected; #3 Docs submission accepted with security/replay fixes; #4 atomic schedule import accepted; #5 local photo reminders accepted with revision protection. Reviewed heads are in [CLAUDE_REVIEW.md](CLAUDE_REVIEW.md). |
| 2 | Security/RLS | Parent-document lifecycle now gates links and files; orphan files denied. Strict role/committee RLS retained. Remote allow/deny tests and exact retry passed; anonymous table grants remain zero. |
| 3 | Submission architecture | Google Doc ID/host validation, committee-token scope, Draft creation and service-only RPC boundary reviewed. Actual assigned Chair contacts replace mailbox assumptions. HTTP/Storage verification remains blocked by absent server key. |
| 4 | Extension architecture | Retain separate operations snapshot/RPC, shared durable outbox and receipts. Parallel snapshots are not cross-module atomic; server write validation protects invariants. |
| 5 | Codex fixes | Lifecycle visibility, payload-bound replay, cross-committee UUID locking, rotation recheck, ambiguous upload preservation, content-hash paths, stale-edit protection, recovery identity binding and Chair contact projection. |
| 6 | Claude follow-ups | Protected Preview/staging, HTTP/QR burst rehearsal, staff-device enrollment/load, monitoring, rollback, orphan-upload reconciliation and future Drive automation. |
| 7 | Role labels | Admins / Executive in public UI; internal logistics/admin identifiers unchanged. |
| 8 | Awards | Rubric controls and rubric writes retired; legacy records retained. Alphabetical factual participation context, no automatic award ranking. |
| 9 | Current session | Shared committee selection authoritative across Chairs; timestamps only suggest. Submissions may have no session; debate requires selection. Remote and two-browser convergence verified. |
| 10 | Queue reorder | Open/for/against speaker and active-speech POI queues persist ordered IDs, with drag and accessible move controls. Revision/fingerprint protection; no reorder audit noise. Future amendment queue remains deferred. |
| 11 | POI queue | Separate from speakers and attached to active speech. Only recognition creates the asking delegate’s +1/+2 event; remote replay exactly once verified. |
| 12 | Speech classes | Main Submitter, Co-Submitter, For, Against, Other; Chair-selected +1/+2/+3 remains separate from opportunity counts. |
| 13 | Main/Co-Submitter | Resolution-linked Main speech, once-only Main credit; Co speech requires Main’s yield and cannot yield onward. Finishing returns control to Chair. Local/remote checks passed. |
| 14 | Open/closed debate | One open queue or separate For/Against queues; Chair explicitly controls mode and active phase. |
| 15 | Extend POIs | None, 1, 2, 3, Any, custom allowance and extension; allowance changes do not create participation records. |
| 16 | Divide the House | Individual roll-call For/Against voting; abstention rejected. Votes/outcome persist; local and remote checks passed. |
| 17 | SC veto | Configured canonical P5 delegate IDs, substantive votes only; present P5 Against yields Failed—Veto with causing delegations. Tests cover no/one/multiple veto, P5 abstention/absence, non-P5 Against, procedural and disabled-rule cases. |
| 18 | Amendments | No parser, structured document editor, automated editing or amendment submission built. Future additions/modifications and human-applied Google Doc changes remain deferred. |
| 19 | PRs / main SHA | Core branch pushed through `35f89be`. PR merges pending; no resulting merged main SHA claimed. #6 remains draft/unmerged. |
| 20 | Development migrations | Accepted operations, schedule, photo, hardening, procedure, history grants and staff contacts applied only to `opmydpozhdgkpcnjwpqb`. Latest contact version `20261006073442`; no replay. |
| 21 | Remote verification | SQL/Data API workflow, fresh repository persistence, RLS/retry, schedule/photo and contact persistence passed. Full public HTTP/upload boundary still unverified. |
| 22 | Advisors | 34 security WARN: 33 anonymous staff-bootstrap warnings, one password-protection warning. Performance 69 unused-index INFO only. |
| 23 | Typecheck | Passed on final rerun. |
| 24 | Lint | Passed on final rerun. |
| 25 | Tests | 68 passed on final rerun, including migration/RLS, procedure and outbox tests. |
| 26 | Build | Final production build passed after the reliability fix. |
| 27 | Browser | Chair/Approval/Admins, approval/printing, two identities/shared session, contact save/reload verified. Final desktop/mobile, close/reopen and conflict evidence still to complete. |
| 28 | Remaining risks | Missing server key blocks HTTP/file acceptance; staff read p95 13.093 seconds; distinct staff devices/QR bursts and school NAT untested; final recovery/browser checks, release infrastructure and advisor dispositions outstanding. |
| 29 | Next Claude work | Preview and staging rehearsal with separate staff/QR load, Observability/performance, deployment protection, monitoring/rollback, then future Drive archive jobs. Keep human Chair access separate from automation identity. |

### Browser recovery checkpoint (6 October)

Two real remote participation actions survived an offline browser reload and synced on reconnection. Outbox returned to zero; remote receipts `cef8dca6-c2a8-4965-9eee-0955f1b313ed` and `eabec35c-1328-4cbc-aded-d544542d8bf5` each produced exactly one event. Mobile Chair layout at 390 px had no horizontal overflow. The isolated public form was visually inspected using explicit demo data; its checkbox wording matched and no Supabase/Auth network requests were observed. This is not a substitute for remote HTTP submission verification. Full browser-process close/reopen and two-Chair conflict rehearsal remain separate acceptance checks. Realtime showed its yellow degraded state after the network interruption; automatic recovery to a subscribed channel still requires verification.

The existing PR #5 GitHub `verify` job was cancelled at its 15-minute limit, without a reported failed test step. It is not a passing CI result. Ordered merges remain on hold until the integration checks and public HTTP gate are resolved; PR #6 remains draft. No production deployment occurred.

### Pass completion

Draft integration PR: https://github.com/zhrsidd/MUNOS/pull/7 (base: `claude/photo-reminders`). Final code commit: `a461def`; no main merge. PR #6 remains draft. Final production browser returned GREEN/Synced after reload with no runtime errors. An ungranted device's attempt to select a session was rejected with “Conference access is unavailable. This device cannot record changes until access is restored,” and the selection remained unchanged. GitHub CI for #7 is pending at handoff. All 68 tests, typecheck, lint and final production build passed locally. Outstanding remote HTTP, full browser-process restart/two-Chair conflict and automatic Realtime-recovery checks remain acceptance gates.

### Follow-up verification

GitHub CI passed for `979f946` (run `37432150047`, 1m21s). A 20-second browser network interruption showed YELLOW/live updates unavailable; after reconnect, the same page returned to GREEN/Synced within 20 seconds without a reload and with no runtime errors. On the subsequent server-key check, `SUPABASE_SECRET_KEY` was still absent from this checkout's `.env.local` and inherited process environment; remote public HTTP testing remains blocked until the key's configured location is identified.

### Server-key acceptance gate resolved — 6 October 2026

The key was loaded only from ignored `.env.local` and the local production server was restarted. No key was logged, committed, exposed through browser configuration, or included in page HTML. No migration was replayed and no grants were widened. The server role's direct public-table read was denied; verification used the intended server-only RPCs and independent SQL checks.

Real HTTP verification against `opmydpozhdgkpcnjwpqb` passed: Google Doc registration created `GA1 / 05` as a Draft; three concurrent same-request retries replayed that one resolution; a new request for the same source returned the original reference; changed payload reuse returned 409; invalid host/submitter/file and invalid/revoked links were rejected. PDF fallback `GA1 / 06` was persisted and downloaded byte-for-byte from private Storage, replay created no extra version, and the public Storage URL was denied. SQL confirmed one version for each Draft in GA1. Synthetic rehearsal links test registration, not actual Google Docs edit permission or document contents.

The actual browser form returned “Already received — GA1 / 05” for a duplicate. Its fresh delegate browser had zero Supabase/Auth requests, zero Supabase local-storage keys and zero cookies, with no runtime errors. No delegate Auth session was created. Evidence: [submission-http-results.json](submission-http-results.json); repeatable HTTP verifier: `scripts/verify-submission-http.mts` (requires the ignored development integration fixture). The short-lived revoked-link fixture was removed; clearly labelled development rehearsal Drafts remain for inspection.

Typecheck and lint passed after adding the verifier; application code was unchanged. Prior 68-test/build results remain valid. This resolves the previously recorded missing-key and real public HTTP/Storage gates. Full browser-process restart/two-Chair conflict rehearsal, upload-failure/lost-response browser fault injection, and distinct-device staff versus delegate-burst capacity gates remain outstanding. PR #6 stays draft; no production deployment or main merge occurred.
