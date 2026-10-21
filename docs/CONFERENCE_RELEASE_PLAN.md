# Conference release plan on the existing direct RPC architecture

Written 21 October 2026 on `origin/main` `276074a` plus branch `claude/isolation-feasibility`. **A plan for owner review. It approves nothing**, contacts no hosted Supabase or Vercel project, and makes no promise that any date, including 2 November, is achievable. It is the owner's recommended alternative to building the full gateway/attestation design before the 5 to 7 November conference.

Labels: **Verified (locally)** = demonstrated on disposable PostgreSQL 17.5 (see [ISOLATION_FEASIBILITY.md](ISOLATION_FEASIBILITY.md)); **Proposed** = not built or not shown; **Untested** = needs hosted evidence. Related: [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md), [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md), [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md). Operator procedures that live on other branches and are referenced by name, not link: `docs/NUMBERING_HOSTED_VERIFICATION.md` (branch `claude/numbering-verification-packet`) and `docs/LOAD_TEST_EXECUTION_PACKET.md` (branch `claude/load-execution-packet`); neither is part of this branch.

## 1. The scope change this needs, and what it does NOT satisfy

Shipping on the existing transport means the **production-only write gateway, operation-bound proof and attestation/register system of ISOLATION_DESIGN (PRs 1 to 9 of the feasibility report) are deferred** for this conference. That is a change to the owner's lifecycle decision ([INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) "Target safeguards" 3, 5 (partly) and **6**), so it requires the owner's explicit written approval, recorded in `docs/VERIFICATION.md`, with the independent reviewer's acknowledgement. Without that approval this plan is not permitted.

Original gates this plan does **not** satisfy:

| Gate | Status under this plan |
| --- | --- |
| Lifecycle safeguard 6: server/database write boundary so that a Preview with a valid production session cannot write; production-only gateway/capability | **Not met.** Writes stay browser -> PostgREST RPC with the user's token |
| Safeguard 2/3: server-enforced lifecycle marker and signed owner register usable without database access | **Not met** (existing env-based target guard only), unless the optional H6 below is built |
| Safeguard 4 (partly): tools fail closed on stale lifecycle checks | Only the existing guard: no authority, no freshness proof |
| Gate evidence: Preview/direct-RPC denial on production-classified synthetic state; old cached bundle denial | **Not applicable / not met**: direct RPC remains the supported path |

What it keeps: per-user, conference, committee, role and revocation checks inside the existing functions, mutation UUID idempotency, PT409/40001, the durable outbox, RLS on every table, one hosted project, no cloud-agent access after promotion.

The alternative is to keep every original gate and move the delivery date (section 8).

## 2. Residual risk, stated plainly

1. **A holder of a valid production staff token can call the authorised RPCs from any client** (curl, a script, a Preview, a stale bundle). The architecture does not cryptographically bind writes to the Production deployment. What limits the damage is only what that user is already allowed to do (their role, conference and committee, expiry and revocation), plus the idempotency and conflict checks. Headers, Origin, CORS, the publishable key and any client flag are not proof (ISOLATION_DESIGN 6.2).
2. **Session theft or reuse is bounded only by token lifetime and grant revocation.** Revoking a grant is immediate (Verified locally: valid token, no grant, `42501`); revoking a session is not (A1, A2: hosted behaviour Untested), so incident response relies on grant revocation and the token wait-out.
3. **The service-role/secret key surface.** `SUPABASE_SECRET_KEY` is used by the submission/amendment routes and the health probe. `service_role` bypasses RLS. On the *modelled* baseline it also holds DML on all 36 `public` tables and EXECUTE on every RPC (default privileges); **the hosted ACLs have not been audited** (A14), and `lib/platform/health-probe.ts` claims "no table grants", which is unverified. A leaked, old or Preview-held secret key is therefore potentially a full-database write credential. The controls are custody (Production runtime only, rotated at cutover, never in Preview/agent environments) and, if the hosted audit confirms the exposure, table-privilege revocation (H2).
4. **Old or Preview deployments** built before the change retain whatever keys they were built with; the only control is retiring them (Section 4, item 6).
5. **Two reads remain direct** (snapshots, Realtime) as in the design (D8).
6. **The anon sign-in plus access-code path** (`redeem_access_code`) stays directly callable by any anonymous session holding a valid code.
7. **No tamper-evident lifecycle record** inside the database unless H6 is built; a database owner-level role (dashboard, Management API, agent connector) can change anything, which is why agent access is revoked at cutover.

## 3. What must be true to ship

Every row is an acceptance gate. "Verified" evidence for any hosted row must be dated and recorded in `docs/VERIFICATION.md`; none exists yet.

| # | Must be true | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Role, committee, grant, expiry and revocation boundaries independently checked on every write RPC and read path from the T1 inventory (56 functions, 36 public tables), including negative tests per role and wrong-committee | extend the existing DB tests; Codex review; for each of the 11 write functions a wrong-role, wrong-committee, revoked and expired case | Existing suite is 636 tests passing locally; a per-function matrix is Proposed (about 1.5 days) |
| 2 | Idempotency and conflict boundaries: same mutation UUID replay, different payload `22023`, stale `PT409`, concurrent duplicates, outbox retention on conflict | Verified locally through direct and wrapper paths (feasibility 2.2 g); the direct path is the shipped one | Verified locally; hosted spot-check Proposed |
| 3 | Migration ledger reconciled: committed chain replayed from empty locally (27 files) and each migration applied once to the hosted project, no applied migration edited | local replay Verified; hosted ledger reconciliation Untested | Proposed (0.5 day plus owner access) |
| 4 | PR #59 (sequential Chair numbering, migration 27) verified on hosted using `docs/NUMBERING_HOSTED_VERIFICATION.md` on branch `claude/numbering-verification-packet` | operator procedure, not yet run | Untested |
| 5 | Hosted privilege audit (A14): actual table/sequence/function/default ACLs of anon, authenticated, service_role on the hosted project, compared with the generated inventory | read-only query set from `scripts/isolation-inventory/inventory.mts` run live | Untested (0.5 day) |
| 6 | Connected Previews and immutable deployments retired or unreachable; no Preview/Development/branch variable holds hosted values or the secret key | Vercel inventory by a human; denial probe from an old URL | Untested |
| 7 | Old test and agent credentials, PATs, database passwords, API keys, `user_access` test grants and QR credentials revoked; agent/MCP access to the project disconnected | cutover step 3 checklist, human-executed | Untested |
| 8 | Production credentials rotated (secret/service key, publishable key if policy requires, DB password); new values only in Production runtime; legacy key types confirmed | human; no agent sees values | Untested |
| 9 | Token wait-out or revocation evidence: either a pre-issued token from a revoked session is shown denied on read RPC, table read, write RPC and Realtime on synthetic state, or the wait-out of ISOLATION_DESIGN 7.3 is applied from `T_stop` using an evidenced `L_max` | hosted; Realtime and session behaviour Untested | Untested (1 day plus wait) |
| 10 | Backup/recovery/rollback: backup coverage including Storage objects understood, a restore rehearsed on disposable/local state, application rollback only to a build compatible with rotated credentials | rehearsal record | Untested (1 day) |
| 11 | Small compute recorded and the 110-device / 19-committee load run plus a real-browser, multi-device offline/reconnect/restart rehearsal run **on the exact release path** (direct transport, the release candidate SHA, Production-shaped configuration) per `docs/LOAD_TEST_EXECUTION_PACKET.md` on branch `claude/load-execution-packet`; Micro results are development evidence only | owner-approved, human-supervised; spending approval | Untested; not authorised by this document |
| 12 | Existing target guard, expected-ref and denied-ref (PHESMUN) behaviour verified at build, runtime and health for the promoted ref; no allow-list lists it as test after promotion | local unit tests exist; hosted configuration check | Partly Verified locally |
| 13 | Release approval by John Paul Ribeiru for the exact SHA; owner approval of the scope change, of Small compute and of every hosted action | recorded | Required |

Harness compatibility: the rehearsal and load harness already call the same RPCs through the shared `SupabaseTransport` or supabase-js with real sessions, so on this plan it exercises the shipped path unchanged. (Under the gateway option it would have to be rewritten and its origin/auth/runtime behaviour re-proven; that is not assumed here.)

## 4. Cheap hardening available WITHOUT a gateway

Effort is engineer-days of implementation, excluding independent review (about 1 to 2 working days elapsed each, overlapping) and hosted application by a human.

| ID | Item | Status | Effort |
| --- | --- | --- | --- |
| H1 | Migration: `ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS` (schema `public` and PUBLIC) for the migration owner, with explicit `GRANT`s on every existing function that needs one, so later `DROP`+`CREATE` or overloads are not silently exposed | Verified locally on the modelled baseline (feasibility 3.4); every later migration then needs explicit grants (verified: a new read RPC was unreachable until granted); hosted Untested | 1.0 |
| H2 | Migration: revoke INSERT/UPDATE/DELETE/TRUNCATE on `public` tables (and sequences as needed) from `service_role`, plus the matching default-privilege revoke for tables. Server routes use only RPCs (`submit_*`, `*_link_info`) and the health probe uses an RPC and a Storage call, so they need no table DML; test and fixture tooling that uses the key for table writes would stop working, which is intended after promotion | Verified locally: after the revoke a direct `service_role` UPDATE fails and the submission wrapper path still works; **only worth doing if the hosted audit (item 5) shows the grant exists**; Storage uses its own schema | 0.5 to 1.0 |
| H3 | Revoke direct EXECUTE on the four `private.apply_*` from `authenticated` | **Not possible on the direct path**: `public.apply_*` are SECURITY INVOKER routers and need the caller to hold EXECUTE on them. Making the public routers DEFINER would change protected existing functions; not recommended here | n/a |
| H4 | Inventory generator as a CI/review check (`--check`) so grants drift (new function, new table, default ACL) shows up in review | Verified locally (generator runs and `--check` passes); CI wiring Proposed | 0.5 |
| H5 | Hosted read-only privilege audit (A14) using the same queries | Untested | 0.5 plus human access |
| H6 | Optional: server-side lifecycle marker and raise-only token floor enforced in the existing `has_access` check (no gateway, no proof). Gives a recorded phase, key-independent revocation of pre-promotion tokens and tamper-evident log. Modifies a protected, widely used function, so it needs the most review | Marker, log and floor logic Verified locally in the prototype; enforcement inside `has_access` and its performance not built or tested | 3.0 (not recommended unless the wait-out cannot be evidenced) |
| H7 | Secret handling: secret key only in Production runtime, removed from Preview/Development/CI/agent environments, rotated at cutover, never logged; verify no bundle contains it | Proposed (existing server-only pattern); human steps | 0.5 |
| H8 | Revocation proofs on synthetic state (grant revoke, expiry, floor/wait-out) across RPC, table read and Realtime | grant revocation Verified locally; hosted token behaviour Untested | 1.0 |
| H9 | Existing target guard (`lib/platform/target-guard.ts`): confirm exact ref, registry and deny-list configuration at promotion; owner-controlled copy of the production ref outside the database | partly Verified locally; no freshness authority | 0.5 |
| H10 | Per-function authorisation matrix tests (table row 1) | Proposed | 1.5 |

Recommended minimum: H1, H4, H5, H7, H8, H9, H10 (about 5.5 days) and H2 only if the audit shows the exposure (0.5 to 1). H6 is optional.

## 5. Schedule (dates are targets, not commitments)

Assumes the owner approves the scope change by Thursday 22 October, one engineer, Codex review within about one working day per change, hosted preproduction access until cutover, and that nothing in the hosted audit is a surprise. **Code freeze** (release candidate SHA) is distinct from **data entry**.

| Date | Work |
| --- | --- |
| Thu 22 Oct | Owner decisions: scope change, Small compute and load window, who executes human steps. H1/H4/H10 start |
| Fri 23 to Mon 26 Oct | H1, H2 (if needed), H4, H10 implemented and reviewed; PR #59 hosted verification; ledger reconciliation; hosted privilege audit (H5) |
| Tue 27 Oct | **Release-candidate code freeze** (SHA recorded). Upgrade to Small; documentation and verification entries |
| Wed 28 to Fri 30 Oct | Load run and real-browser/offline rehearsals on the exact candidate (execution packet); revocation proofs (H8); restore rehearsal |
| Sat 31 Oct | Rehearsal review and go/no-go; failures fixed only as targeted, reviewed changes (a fix means re-running the affected evidence) |
| Sun 1 Nov | Fix window |
| Mon 2 Nov | Cutover steps 1 to 6 (write pause): retire Previews, revoke test/agent access and credentials, rotate credentials, change lifecycle/registry, token wait-out starts |
| Tue 3 Nov | 48-hour pre-conference freeze begins; production build released from the verified SHA; human non-destructive checks |
| Wed 4 Nov | Wait-out complete and recorded; release approval; **only then** real data entry (bootstrap Executive, grants, codes) |
| Thu 5 to Sat 7 Nov | Conference |

This is **very tight**: it leaves one fix day, leaves no slack for a hosted surprise (A14, default ACLs, Realtime after revocation), and depends on owner approvals and Small spending being given on 22 October. If the load rehearsal fails, the honest options are a smaller, documented capacity/limit with the owner's approval or no real-data entry on this project. The earlier proposal of 31 October load / 1 November fixes / 2 November cutover is the same shape; this plan only moves the freeze earlier and adds the evidence above.

## 6. Owner approvals needed

1. The lifecycle scope change in section 1 (deferring the gateway and attestation gates), in writing, with the residual risk in section 2 accepted.
2. Small compute and spending for the load and rehearsal window; the exact workload and stop authority.
3. Which hosted human actions are performed, by whom (privilege audit, ledger reconciliation, migrations H1/H2, credential rotation, Preview retirement, agent disconnect).
4. Whether H2 and H6 are wanted.
5. John Paul Ribeiru's release approval for the exact SHA after the evidence is in.

## 7. What changes in documents

`INFRASTRUCTURE_LIFECYCLE.md`, `V1_RELEASE_CHECKLIST.md` rows 1.4.x and `AGENTS.md` must record the scope change and the unmet gates through a separate reviewed change; this document does not edit them.

## 8. The alternative: keep all original gates and move the date

Implement the full design (PRs 1 to 9 in [ISOLATION_FEASIBILITY.md](ISOLATION_FEASIBILITY.md), about 21.5 implementation days, reviews and rehearsal on top), with the earliest realistic completion about **14 to 20 November** on one engineer, then run the Small load and rehearsals through the gateway and cut over only afterwards. Real conference data would not be entered on this project before then. The conference dates then need either a different, owner-approved arrangement for data capture (outside this project) or a delayed start; that is the owner's decision. A partial gateway (revoking direct RPCs without the route, proof minting and transport change) is **not** an option: it makes every staff save fail.
