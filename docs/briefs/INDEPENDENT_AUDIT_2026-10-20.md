# MUNOS independent review and Claude handoff
20 October 2026 · Conference: 5–7 November 2026

## A. Executive assessment

**Suitable for continued feature development; not yet accepted for conference release.** The automated baseline is healthy, the core outbox and authorization protections remain in place, and PR #25 improves fail-closed operator targeting. The highest-priority work is cutover isolation, offline amendment-history retention, correct print quantities, submission-body bounds and Chair touch controls. No P0 exploit or confirmed loss of server records was established.

This is a source, automated-test and read-only database review with an incomplete browser acceptance pass. It is not release approval or a blanket security certification. Claude remains implementation owner.

### Baseline and evidence

- MUNOS `main`: **e0796a30aa4eb1152e46e016b09cd6c6225597ab**; rechecked unchanged at the end. PR #31 is merged at this commit. PR #25 is merged as `47633a1`, from head `4218dc0`. The open-PR API returned no open PRs.
- Graphify reports the exact same `e0796a3` index. Its PR #25 review reported no static issues, explicitly without running tests; that is supplementary evidence.
- PHESMUNOS: **73e337e62cecb870e906500cbe12779ec12c4c80**, accessed through the connected GitHub account. Its tree, operational components and relevant migrations were inspected. No legacy database was contacted.
- Read root `AGENTS.md`, `docs/START_HERE.md`, `HANDOFF_REVIEW.md`, `BRAND.md`, active UI priorities, deployment, access model, voting, session and release specifications. Root entry files in the brief live under `docs/`.
- Local source was retrieved at the pinned commit through GitHub because shell DNS prevented cloning. Dependencies installed from the existing npm cache. No tracked application source correction was made, no PR was opened and nothing was merged or deployed.
- The pasted brief was read in full. The attached addendum ZIP resolved successfully, but its download failed and Library could not extract readable contents. **Its contents and port-manifest requirements remain unreviewed.** Current repository specifications were used; this report must not be represented as confirmation that every ZIP item is covered.

### Verification results

| Check | Result and boundary |
| --- | --- |
| TypeScript | Pass, `npm run typecheck` |
| ESLint | Pass, `npm run lint` |
| Production build | Pass, `npm run build`, isolated demo configuration |
| Local suite | 423 tests: **419 passed, 4 skipped, 0 failed** |
| Local test invocation | `npm test` hit EPERM creating tsx's IPC socket; `node --import tsx --test tests/*.test.ts` completed successfully |
| PostgreSQL concurrency | Four suites skipped locally; no reachable disposable PG17 target was configured |
| Exact-commit CI | [Run 39439357796](https://github.com/zhrsidd/MUNOS/actions/runs/39439357796), successful; job logs show **432 passed, 0 failed, 0 skipped**, with real PostgreSQL 17 |
| Hosted database | Read-only catalog/advisor checks on DCMUN `kllhswucdhqqywnzxado`; 21 migration versions match the repository filenames |
| Browser | Local Next server refused `listen 127.0.0.1:3100` with EPERM; browser received connection refused. Existing PR #31 Preview redirected to Vercel login |
| Responsive and end-to-end acceptance | **Not completed.** No new desktop/tablet/mobile alignment measurements, authenticated scoring saves, real two-device tests or before/after screenshots |
| Hosted load and real records | No load test, migration, data change, grant change, key change or production action performed |

CI counts exceed local counts because the PostgreSQL suites execute nested tests instead of being skipped. This is not a test-count regression.

## B. Confirmed findings

### F1 · P1 / high operational risk — cutover does not isolate existing Previews

**Evidence:** `next.config.ts:7–14` guards PHESMUN globally but checks expected target only for Vercel Production. `lib/platform/target-guard.ts:106–113` likewise accepts Preview without checking development/staging eligibility. `docs/DEPLOYMENT.md:51–57` moves allow-lists and sets the production expectation but does not explicitly retire every existing Preview or remove its database configuration. Submission/amendment backend constructors do not add a runtime target check.

A local pure-function reproduction returned `null` (no target problem) for Preview pointing at the DCMUN ref **even with that ref supplied as EXPECTED_SUPABASE_REF**, and with no allow-list. In contrast, operator tools refuse after all allow-lists are removed.

**Impact:** changing operator variables does not revoke a deployed app's previously supplied URL or credentials. This is a confirmed enforcement gap and a cutover risk, not evidence that real conference data is currently exposed. Existing RLS and conference scoping still apply.

**Smallest safe fix:** add an explicit cutover step to inventory and disable/delete or otherwise make old cloud Previews unable to use the promoted project; remove cloud configuration from future Previews or provide a genuinely separate test target. Revoke the Preview-specific secret key, and remove test grants/sessions using the approved cleanup plan. Do not assume updating environment variables retroactively changes old deployments. Add a shared cloud-target check at server/client creation and build boundaries, with an explicit non-production policy; it supplements, rather than replaces, old-deployment retirement.

**Acceptance:** inspect both an old immutable Preview and a newly built Preview after a rehearsal cutover. Neither can read/write the promoted database; production still works. Keep the 110-device rehearsal before cutover. No new DB schema is inherently needed.

### F2 · P1 / medium — passed amendment history is not durable offline

**Evidence:** `components/amendments/history.tsx:23–40` keeps fetched history in React `useState` only. `lib/amendments/history.ts:4–6` explains that normal snapshots include only amendments for the resolution currently in debate. The error/empty copy at component lines 43–45 implies history remains available on the device.

**Reproduction:** fetch passed history online, close the resolution so it is omitted from the next snapshot, then reload offline. The fetched array starts empty and the history request fails. A previously viewed older amendment need not be present anywhere in durable state. Server records are preserved; offline availability is lost.

**Fix:** persist authorized read-only history pages in a bounded cache keyed by actor, conference and committee, then merge cached, snapshot and fetched rows by id/revision. Retain resolution identity, delegation display and safe working-Doc pointer needed offline. Respect existing access leases/revocation behavior and keep it separate from the mutation outbox.

**Acceptance:** load more than 50 records, close/change sessions, reload offline and recover exact wording plus metadata; no cross-actor/committee leakage. Test failed fetch, cache failure, identity changes and stale in-flight page responses. No hosted migration is required; an IndexedDB schema change may be appropriate.

### F3 · P1 / medium — printing still assumes 24 copies

**Evidence:** `lib/commands.ts:419` initializes copies to 24; the approval path at lines 347–358 does not recalculate them. Foundation SQL line 106 defaults to 24. No committed MUNOS print-copy helper/trigger exists. Read-only live catalog inspection found document decision/round triggers, but no print-copy trigger.

PHESMUNOS has `lib/print.ts` and migration `20261010200000_print_copies_from_delegates.sql`, setting copies at approval to committee delegates + 3 spares. The active MUNOS brief explicitly retains that rule.

**Isolated reproduction:** approve a seeded resolution in a 12-delegate committee: **actual 24, expected 15**.

**Fix:** port the counting behavior through a new reviewed forward migration and matching local command logic. Compute on the server so logistics does not gain roster access. Reapproval must recount. Decide explicitly how already-approved records are updated; do not run the legacy migration directly against DCMUN.

**Acceptance:** 0, 12 and larger committee sizes; reapproval after roster change; logistics can read only the resulting quantity; immutable workflow/audit behavior and retries remain correct.

### F4 · P1 / medium — 64 KB public submission limit trusts Content-Length

**Evidence:** `app/api/submissions/route.ts:9–13` checks only the header, then fully parses `request.formData()`.

**Isolated reproduction:** a multipart Request with **70,615 bytes**, absent Content-Length, reached semantic validation and returned **400 invalid_title**, rather than **413 too_large**. No database call or stored submission was needed.

**Impact:** the application's advertised 64 KB bound is not enforced for streamed/headerless requests. Platform limits may provide an outer bound; this is not a claim of unlimited hosted uploads or a demonstrated hosted denial of service.

**Fix:** retain the early header rejection, then read/count bytes with a hard limit before multipart parsing. Reject on excess and cancel the reader. Apply the same bounded-body pattern to other public endpoints after checking their limits.

**Acceptance:** valid small body, exact boundary, boundary + 1, absent/malformed/misleading length and chunked stream. Rejection precedes backend RPCs. No migration.

### F5 · P1 / medium usability — dense scoring targets remain below the requested size

**Evidence:** `app/globals.css:930–934` overrides the shared button to minimum **27 × 29 px**; the narrow-screen rule at 2107 increases width to 28 px without raising that height. The coarse-pointer rule at 146–150 raises only primary buttons. `components/chair.tsx:36–60` renders score controls without primary styling.

The specific old claim of **24 px** was not reproduced. Current CSS still permits targets well below approximately 44 px. This is source-confirmed sizing behavior, not a new browser measurement.

**Fix proposal:** a two-row delegation entry on narrow/touch screens: identity/counts first, compact category groups beneath; score buttons minimum 44 × 44 px with 8 px gaps and wrapping. Keep rapid direct +1/+2/+3 actions, stable focused-row order and accessible country/category labels. Reconcile existing scorer selectors at the source instead of adding another overriding layer.

**Acceptance:** 320/390/768/1280 px, coarse pointer and actual 200% zoom; long country/name text, multiple rows and up to ten configured values; no horizontal clipping, accidental row movement or loss of keyboard focus.

## Protected review disposition

**PR #25:** the removal of the implicit development ref is sound and does not weaken the operator guard. Missing lists fail closed; contradictory project roles and the forbidden PHESMUN ref remain refused. **Qualified acceptance of the narrow change, with F1 a cutover blocker.** This is retrospective review, not permission to merge or change production.

**PR #31:** the shared button height, danger hierarchy and wrap rules are present on main. Dense Chair controls were explicitly excluded. Do not report F5 as a new regression introduced by #31. Its changed disabled treatment conflicts with the older “42% opacity” wording in BRAND.md; update documentation in the visual follow-up.

**PR #22 protected areas:** inspected approval-history/adjustment migrations and sync implementation with passing tests. Durable writes commit before optimistic success; stable UUIDs, receipt replay, identity checks, retained conflicts, batching at 25 and acknowledged-but-unconfirmed handling remain. Backoff preserves gateway status, slows overload retries and suppresses passive retry storms. Bundled snapshots fall back only for missing functions, not authorization/timeouts. No additional confirmed authorization or outbox-loss defect emerged in this review. Real cloud multi-device acceptance and capacity remain open.

### Hosted security observations

The live migration ledger contains all 21 committed versions through `20261019100200`. All public ordinary tables have RLS enabled. Anonymous and authenticated roles cannot execute public submission/amendment lookup/write RPCs; service_role can. Staff mutation RPCs permit authenticated and deny anon/service_role.

The live `public.rls_auto_enable()` is a SECURITY DEFINER event-trigger function with `search_path=pg_catalog`, quoted identifiers and public-schema filtering. It enables RLS; it does not grant browser privileges. Its exception handler logs failures, so it must not replace explicit migration RLS/grant checks. No DDL was used to exercise it, and no full live-schema fingerprint comparison was performed.

Security advisors reported authenticated SECURITY DEFINER RPCs, anonymous-auth policies and disabled leaked-password protection. The first two match the intended anonymous-device-plus-scoped-grant design and are not automatically vulnerabilities. Reviewed RPCs contain role/grant checks. An advisor mention of auth.sessions was not treated as a proven leak: a direct privilege check found neither anon nor authenticated has SELECT. Password protection is low relevance to the current access-code flow.

Advisor references: [SECURITY DEFINER RPCs](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [anonymous policies](https://supabase.com/docs/guides/database/database-advisors?queryGroups=lint&lint=0012_auth_allow_anonymous_sign_ins), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Server secret usage is confined to server-side backend/probe paths in the inspected source. No actual production secret or configured Preview bundle was obtained, so this is an import/source review, not verification of deployed secret values.

## C. UI/UX register and browser acceptance handoff

| Requested area | Current result | Required verification / smallest next action |
| --- | --- | --- |
| Main Submitter points configuration | There is no editable configuration: ScoringSettings explicitly renders “Fixed +5 … locked” and “Not configurable” (`components/admin.tsx:888–897`) | Treat configurability as pending product work. Check its current locked-row alignment visually; do not claim an editable input was repaired |
| POI number controls | Real custom-number form uses flex wrapping and end alignment (`debate-console.tsx:176–177`, CSS 2473–2477) | Render an active speech, presets and custom allowance at all widths; measure input/button rectangles, exercise None/Any/custom/Extend +1, Enter and touch |
| Voting panel header | Uses shared Panel heading; procedure actions contain an inline labelled select (`voting-console.tsx:19–22`) | Test normal/divide/procedural, long resolution code/title and wrapping; no confirmed visual defect assigned without rendering |
| +1/+2/+3 Participation | F5, source-confirmed undersized minima | Use proposed 44 px direct-action layout and verify real computed dimensions |
| Buttons, dialogs, destructive/disabled styles | #31 supplies a real shared system; dense exceptions and legacy selectors remain | Inspect all four roles, action groups, overflow, focus and confirmation dialogs; resolve BRAND disabled-style wording |
| Passed history | Functional F2; inline bespoke spacing/radius remains | Fix durable behavior first; align spacing with tokens in a later small visual pass |

**No before/after UI screenshots are supplied:** no correction was implemented and application content could not be reached in a browser. Existing repository screenshots are prior evidence, not fresh measurements. The three alignment allegations remain open verification items, not invented confirmed defects.

## D. PHESMUNOS parity matrix

Evidence comes from actual source, not its README alone. Shared module names were cross-checked against MUNOS implementations; later legacy migrations identify additions absent from MUNOS.

| Capability | PHESMUNOS | MUNOS at reviewed main | Disposition |
| --- | --- | --- | --- |
| Staff codes, scoped workspaces and revocation | Present | Present | Retained; test hosted access lifecycle |
| Central schedules, committee/session archive safeguards | Present | Present | Retained; session redesign remains separate draft |
| Roll call, open/For/Against queues, speech/yield/POI workflow | Present | Present | Retained with redesigned country picker |
| Normal, divide-house, majority arithmetic and veto | Present | Present | Retained; observed-majority shortcut pending |
| Resolution review/printing lifecycle, working Docs, amendments | Present | Present | Retained |
| Uploaded resolution fallback | Present | New file uploads refused; historical read path retained | Deliberate retirement |
| Passed amendment wording after debate | Current-resolution workflow | Added bounded history in #29 | Improvement, with offline F2 still open |
| Optional delegate email and committee-column import | Legacy optional-email migration and import handling | Email mandatory in `lib/import.ts:43–46` and `commands.ts:510–525` | Useful missing port; validate actual registration sheets before prioritizing |
| Staff rename/role/reassignment/removal | Legacy staff-edit migration and UI | Add staff and edit contact email only | Missing port; important if roster assignments change |
| Debated Amendment automatic once-only credit | Legacy amendmentId + unique constraint, default +2, configurable | No automatic award in `lib/batch/commands.ts:51–58`; category absent from required scoring | Missing; include protected scoring feature |
| Main Submitter fixed credit | +5, once per resolution | Same | Retained; new request to configure is additional scope |
| Copies = delegates + 3 | Legacy helper + approval trigger | Fixed 24 | Regression F3 |
| Chair-school photo inclusion | Delegate-based photo workflow | Delegate-based, no staff school field | New feature, not an established legacy regression |
| About/credits | Real `app/about/page.tsx` | No About route in current tree | Approved port pending; use owner-specified credits |
| Leo deterministic helper/inbox | Legacy `components/leo-helper.tsx`, `lib/leo/*` | No equivalent helper modules | Felix port pending; supplied assets were not verified here |
| Reviewed outbox reconciliation | Legacy recovery module/migration | Export and retained-conflict workflow; no reviewed reconciliation module | Explicitly excluded by current scope; do not auto-port |
| Drive mirroring, awards, projector/server timer | Some legacy code/docs remain | Retirement direction, local speaker timer retained | Deliberate retirements; no restoration recommendation |

Do not copy the legacy schema bundle wholesale. Its migration history diverges after the shared base. Port specific behavior with new DCMUN migrations and tests.

## E. Protected feature specifications

### Observed clear-majority voting

Existing arithmetic (`lib/commands.ts:611–624`): simple majority passes when For > Against and at least one non-abstention ballot exists; two-thirds uses For × 3 ≥ (For + Against) × 2. Abstentions are excluded from that denominator. Present & Voting cannot abstain; Divide the House permits For/Against only.

The requested shortcut is an **observed declared result**, not a way to fabricate counted totals. Add a distinguishable vote attempt with recording method, declared For/Against outcome, actor and server time; leave individual ballots and numerical totals unrecorded/null. Preserve previous counted attempts or a complete audited supersession record.

Initially enable only normal simple-majority votes where no named-roll-call/two-thirds/veto requirement needs evidence the shortcut cannot provide. Safest initial veto policy: disable the shortcut for veto-enabled substantive votes; procedural votes remain subject to their actual rule. Confirm resolution, method and result before closing.

Use existing outbox/RPC authorization, locked resolution revision and idempotent receipt. **A forward migration is necessary:** current contracts require complete named ballots and cannot truthfully store this method. Tests: both directions, ties/all-abstain counted behavior unchanged, incomplete counts, veto eligibility, existing votes/switching methods, duplicate replay, stale/concurrent Chairs, revoked/cross-committee access, reload/offline and honest history/export.

### Chairs in school photos

Add optional explicit staff-school affiliation with a conference-scoped foreign key; never infer it from email or names. Executive edits it through versioned commands. Match each photo school against both delegates and assigned Chairs; keep reminders even when a committee has only a matched Chair and no matched delegate.

Show separate delegate/Chair counts and names only in authorized staff views. Keep revision-based warning/due acknowledgements, cancellation and rescheduling behavior. Do not expose school affiliation through public submission contacts unnecessarily.

**Forward migration required** for persistent affiliation and snapshot/command projection. Retain existing role boundaries. Tests: null affiliation, Chair-only match, multiple Chairs/schools/committees, wrong-conference school, revoked grant, reschedule invalidating acknowledgements, timezone and offline reload.

### Configurable automatic participation credits

Keep Speech/POI value lists; represent Main Submitter and Debated Amendment as automatic categories with exactly one integer value, proposed range 0–20 consistent with current scoring validation. Conference defaults, then explicit committee overrides. Preserve current +5 Main Submitter default; legacy amendment +2 is a candidate default requiring confirmation against the unread addendum.

Record the awarded value on each event; changing defaults never recalculates old records. Main Submitter remains once per resolution at its defined trigger; Debated Amendment becomes once per amendment at entry into debate. Add amendmentId and a scoped FK/unique constraint. Voiding/correcting does not reissue the original automatic award; preserve audited adjustments/restores.

Define configuration revision handling for queued offline commands: a stale configuration must not silently reprice an automatic award. Retain and explain a conflict or explicitly validate a captured setting revision/value server-side.

**Forward migration required.** Main Submitter alone can reuse existing scoring storage but still needs reviewed function changes; amendment credit additionally needs durable linkage/uniqueness. Update client/server rules, fingerprinting, snapshots, category labels, manual scorer exclusions and exports together. Test zero points, config changes, historical totals, duplicate UUIDs/different payloads, concurrent opening, void/restore, closed/archived sessions and cross-committee attempts.

## Google Docs security assessment

Implemented and covered by passing tests: file parts are rejected even alongside a Doc link; rtpof=true Word-in-Docs links are rejected; URLs are reduced to validated ids and rebuilt on docs.google.com; historical storage/read code and RPC parameters remain; public forms do not create staff Auth identities. F4 is the body-bound defect.

URL shape and rtpof absence **cannot prove native type or Editor access**. Removing the query marker can bypass that heuristic; this is an acknowledged verification limitation, not proof of a new file-upload path. No arbitrary submitted URL is fetched currently, so no new SSRF path was found.

Keep the automated check advisory: bounded anonymous export/open request, timeout/byte cap, fixed Google host/path, no unreviewed redirects, rate limits and no document-content logging. “Anyone can open” does not mean “Chair can edit”; restricted direct-share Docs must remain valid submissions. Persist verified/restricted/unable + checkedAt and use the Chair's manual access record as authority. A reviewed migration is needed for persisted results/recheck semantics. Resource-key preservation remains an already documented lower-priority limitation.

## F. Prioritized action plan

| Priority | Work |
| --- | --- |
| P0 | None established by this review. Escalate if actual cross-role access, lost durable mutations or exposed secrets are reproduced |
| P1 | Resolve F1–F5; port missing operational print/scoring behavior; finish protected contracts before implementation; perform signed-in browser/two-device/offline acceptance; complete approved 110-device/19-committee rehearsal and release approval |
| P2 | Optional-email/import and staff-management parity after confirming roster needs; Google access advisory; resource keys; precise amendment outcome timestamp if needed; durable history pagination race handling |
| P3 | About/Felix finishing, token/spacing cleanup, BRAND disabled wording and stale documentation, subject to owner's existing priority order |

P2/P3 classifications describe technical release risk, not permission to reorder owner priorities.

## G. Claude implementation handoff

1. **First PR: F4 bounded request parsing.** Touch public route/body reader and focused Request-stream tests; no schema change. Require oversize rejection before any backend RPC.
2. **Second PR: F2 durable history.** Add scoped read cache and lifecycle tests; keep mutation receipts/outbox untouched. Verify actual offline reload and history >50 rows.
3. **Third PR: F3 print quantity.** New forward migration + matching local helper/approval behavior + database/RLS/reapproval tests. Independent review before application.
4. **Visual branch: F5 and the three requested alignment checks.** Measure actual elements at 320/390/768/1280 and real 200% zoom; use long realistic names and active voting/POI states; attach genuine before/after captures. Finish the existing #31 system rather than duplicating it.
5. **Protected feature branches:** serialize voting/photo/scoring domain and migration work under Claude. Follow specifications above and active owner decisions. Review each before migration application.
6. **Cutover packet:** make F1's old-Preview retirement, credential revocation, test-data cleanup, target refusal, exact release SHA and rollback compatibility concrete and independently reviewable. No migration/application, production config or release action is authorized by this report.
7. **Close remaining evidence gaps:** inspect the attached addendum/port manifest; complete authenticated cloud/browser flows; verify deployed environment configuration and actual secret separation without exposing values; retain approved capacity and rollback gates.

Do not duplicate completed #27 Docs-only or #29 online-history work. Do not restore retired Drive/award/projector functionality, legacy reconciliation excluded by scope, or the removed SC/HSC proposal.

### Primary source links

- [Pinned MUNOS source](https://github.com/zhrsidd/MUNOS/tree/e0796a30aa4eb1152e46e016b09cd6c6225597ab)
- [PR #25](https://github.com/zhrsidd/MUNOS/pull/25) · [PR #31](https://github.com/zhrsidd/MUNOS/pull/31)
- [Pinned PHESMUNOS source](https://github.com/zhrsidd/PHESMUNOS/tree/73e337e62cecb870e906500cbe12779ec12c4c80)
- [Exact-commit successful CI](https://github.com/zhrsidd/MUNOS/actions/runs/39439357796)

File references and line numbers above refer to these pinned source revisions. The absence of browser screenshots and addendum inspection remains an explicit limitation of this review.

