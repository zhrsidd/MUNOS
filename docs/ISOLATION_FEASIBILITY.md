# Single-project isolation: local feasibility report

Written 21 October 2026 against `origin/main` `276074a` (the merged, approved [ISOLATION_DESIGN.md](ISOLATION_DESIGN.md); its decisions D1 to D19 are **not** selected by the owner and nothing here selects them). This is **local evidence only**. No hosted Supabase or Vercel project was contacted, no migration in `supabase/migrations` was added or changed, no app version, tag, PR or GitHub post was made, and `lib/sync`, the outbox, mutation UUIDs, conflict handling, batching and backoff are untouched.

Labels used throughout: **Verified (locally)** = demonstrated by a command in this report on disposable PostgreSQL 17.5; **Proposed** = a recommendation that is not built or not shown; **Untested** = needs hosted evidence or was not attempted.

## 1. What was built (all disposable, none shipping)

| Path | What | Wired into app/migrations? |
| --- | --- | --- |
| `scripts/isolation-inventory/inventory.mts` + two bootstrap SQL files | T1 inventory generator: replays all 27 committed migrations from empty and reads `pg_proc`, `pg_class`, `pg_policy`, `pg_default_acl`, role and schema ACLs | No. Reads `supabase/migrations`, never writes it |
| `docs/generated/isolation-t1-inventory.{md,json}`, `...-bare.md` | Generated, deterministic inventory (`--check` fails when stale) | Documentation only |
| `prototypes/isolation/` | Lifecycle schema, wrappers, revocation script, 16 boundary checks, benchmark. Marked prototype in every file | No. `npm test` globs `tests/*.test.ts` only; the SQL is applied only by the harness to a throw-away database |

Environment: embedded-postgres 17.5 binaries (`/tmp/pg17x`), cluster run as non-root `nobody` on `127.0.0.1:54417`, `psql` 16.15 client. Every database is created with a unique name and dropped afterwards; the harness and generator refuse a non-loopback host.

**The Supabase baseline is a model.** Roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `authenticator` (NOINHERIT), default privileges `ALL` on tables, functions and sequences in `public` to the three API roles, `auth.uid()/jwt()` with both the `request.jwt.claim.sub` and `request.jwt.claims` forms, and a Storage stand-in are reconstructed from documented behaviour (`supabase/config.toml` says `auto_expose_new_tables` matches "the cloud default") and from the repository's own tests. Differences from hosted that matter: the local `postgres` is a superuser (hosted is not), `session_user` is the connecting role (hosted: `authenticator`), PostgREST is absent, claims are set by the harness with `set_config('request.jwt.claims', ..., true)` and `set_config('role', ..., true)`.

## 2. Verified (locally): commands and results

Baseline: `TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54417/postgres npm test` on the unmodified tree: **636 pass, 0 fail, 0 skipped** (the real-PG17 concurrency tests ran). Re-run of the prototype after the container restart:

```
TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54417/postgres npx tsx --test prototypes/isolation/isolation.proto.test.ts
# tests 16  # pass 16  # fail 0
npx tsc --noEmit        -> clean (the prototype .ts files are included by tsconfig)
npx eslint prototypes scripts/isolation-inventory -> clean
TEST_POSTGRES_URL=... npx tsx scripts/isolation-inventory/inventory.mts --check -> "docs/generated is up to date"
```

### 2.1 T1 inventory (task 1)

`inventory.mts` found **56 functions** (49 callable, 7 trigger), **43 relations**, **43 policies**; every function in `public`/`private` is `search_path=""`, no SECURITY DEFINER function lacks a fixed search_path, no function is executable by PUBLIC, every table has RLS enabled (the one view is `security_invoker`), no column-level grants, no custom roles are created by the migrations. Full tables: [docs/generated/isolation-t1-inventory.md](generated/isolation-t1-inventory.md).

Functions that write and can be called directly through the Data API (before any gateway), **11**:

| Function | Security | Callable by (model baseline) |
| --- | --- | --- |
| `public.apply_conference_mutation`, `public.apply_operations_mutation` | **INVOKER** (routers) | authenticated, **service_role** |
| `public.redeem_access_code`, `rotate_access_code`, `revoke_access_code` | definer | authenticated, **service_role** |
| `public.submit_resolution`, `public.submit_amendment` | definer | service_role |
| `private.apply_mutation`, `apply_operations_mutation`, `apply_procedure`, `apply_staff_batch` | definer | authenticated (schema `private` grants it USAGE; not PostgREST-exposed if A3 holds) |

Table privileges: `authenticated` has SELECT only everywhere; `anon` has nothing; **`service_role` holds INSERT/UPDATE/DELETE/TRUNCATE on all 36 `public` tables** (default privileges, bypasses RLS) and nothing on `private` tables. Default-privilege effect: 12 of 56 functions differ in Data API callers between the model and the bare test bootstrap (all of them gain `service_role`).

### 2.2 Prototype checks (task 2), mapped to the brief

| Brief | Result (Verified locally) |
| --- | --- |
| (a) lifecycle schema, marker, transition log, key ring, token floor, `proof_uses` | `anon`, `authenticated`, `service_role`, `authenticator`, a custom `proto_agent` (member of authenticated) and a no-grant role get `42501` on every table and function; `lifecycle_operator` can run the functions but cannot read or update the tables; even the table owner and a superuser cannot UPDATE/DELETE/TRUNCATE the marker outside lifecycle functions (`GW091`) or touch the log (`GW090`); hash chain verifies, and a superuser who disables the trigger and edits a row makes `verify_chain()` return false (detection, not prevention) |
| (b) wrapper keeps caller identity | **SECURITY DEFINER works; SECURITY INVOKER cannot.** Inside a definer wrapper owned by non-superuser `gw_owner`: `auth.uid()`, `request.jwt.claims` and the `role` GUC are unchanged, only `current_user` becomes `gw_owner`. `auth.uid()` reads a GUC, not the role. Existing function sees the real actor: receipts record the user's id. INVOKER fails for two independent reasons: it needs `authenticated` to hold EXECUTE on the callee (the thing being revoked: after revocation an invoker pass-through gets `42501`, a definer pass-through works) and, for a proof wrapper, USAGE on schema `lifecycle` (contradicts section 5.2: `permission denied for schema lifecycle`) |
| (c) public submissions, server principal, no user session | `gw_submit_resolution` (9 args) and `gw_submit_amendment` (7 args), `service_role` only, proof `typ=server`, `sub=route:submissions/route:amendments`, `sid` forbidden. Outcome sequence equals the direct call: created, replayed, `idempotency_conflict`, duplicate, `invalid_link`; no `auth.users` row created; wrong route, user proof, no proof, `anon`/`authenticated`/no-grant callers all refused with no row written |
| (d) access codes | rotate, redeem, revoke work through wrappers; the new grant is usable through the mutation wrapper; non-Executive rotate refused by the existing check (`42501`) **and the failed call does not consume its `jti`** (whole statement rolls back); replay of a rotate/revoke proof `GW040`, nothing created; two concurrent uses of one `jti` from two connections: exactly one wins and the loser sees `GW040`, not a raw `23505`; the 8-failure redeem rate limit is unchanged (`invalid` x8 then `rate_limited`); revocation with devices is immediate for an already signed-in device (valid token and proof, grant gone, `42501`) |
| (e) direct-RPC denial | After `30_revoke_direct.sql` (11 functions, from PUBLIC, anon, authenticated, service_role, authenticator): `has_function_privilege` false for six roles plus PUBLIC on all 11; every direct call as each of six roles, with a valid chair session, gets `42501` and changes no row; the same session through the wrapper succeeds; reads (`conference_snapshot`) untouched. Default-privilege behaviour in section 3 |
| (f) argument binding | 143 negatives (every argument of all 7 wrappers; each altered to a different value, NULL<->empty string, case change, added whitespace): all `GW034`, state fingerprint (receipts, submissions, credentials, grants, attempts, proof uses, attendance) unchanged. Re-serialised but semantically identical JSON is also refused. Static check from `pg_proc`: every `gw_*` wrapper has the same argument names as the function it wraps and its digest array lists them all, in order |
| (g) UUID idempotency and PT409 | Identical sequence through direct and wrapper: ok, replay with same `client_time` ok (no new receipt), same UUID different payload `22023 Idempotency key reused`, stale `expected` `PT409` with no receipt, then ok; same messages, receipt counts and revision steps. Fresh proof for a retry adds no row and no proof use. Concurrent duplicates from two sessions: one effect. Still true in phase `production` |
| (h) key classes and transitions | `preproduction` accepts only `test`; evidence/production keys cannot be added there (`GW011`). `->synthetic_locked` revokes test keys (`GW021`), and if a superuser re-activated one its class is still refused (`GW022`); `evidence` key accepted (positive control); staged production key refused. Skip (`pre->prod`) `GW014`, stale epoch `GW013`, non-operator `42501`, register seq must rise `GW015`, demotion refused while real data attested, allowed otherwise and revokes keys. Promotion needs exactly one staged production key (`GW018`), mandatory barrier inputs (`GW016`) and **early refusal until B = last_issued_at + V_att + margin** (`GW017`; now vs 24 minutes ago with a 25 minute barrier both refused, 26 minutes allowed). After production: only the production key works, `production -> anything` `GW014`, no new keys, log reads `init, pre>sl, sl>pre, pre>sl, sl>prod` with epochs 1..5 and a valid chain |
| (i) token floor and revocation (simulated claims) | Floor 0 accepts an old token; after `raise_token_floor(F)` a token with `iat < F` is `GW052`, `iat >= F` ok; floor can only rise (`GW012`); missing `iat` or `session_id` claim refused (`GW052`/`GW051`); wrong `sub`/session/project/epoch refused (`GW050/051/031/032`); at promotion the floor is `ceil(now)`: a token issued the second before is refused. Revoked or expired `user_access` is refused immediately by the **existing** `has_access`, with a valid token and valid proof |

### 2.3 Local overhead (Verified locally; LOCAL ONLY)

`BENCH_SECONDS=10 npx tsx prototypes/isolation/bench.ts` (pgbench 16 against PG17.5, loopback TCP, one 4-vCPU container, simple protocol, each iteration `begin; set local role; set_config(claims); call; commit`). No PostgREST, Auth, TLS or Vercel hop is included, so **these are not capacity or end-to-end figures.**

| Variant (1 client, mean latency) | Run A | Run B |
| --- | --- | --- |
| direct `apply_conference_mutation`, fresh write (participation) | 1.42 ms | 1.96 ms |
| wrapper, fresh write, proof minted in SQL (includes ~0.1 ms mint) | 1.70 ms | 2.34 ms |
| direct, replay of stored receipt | 0.29 ms | 0.36 ms |
| wrapper, replay, pre-made proof (pure verify + call) | 0.45 ms | 0.82 ms |
| Node reference minter (HMAC + digest), in process | 6.7 us | 10.4 us |

Database-side cost of the check is therefore roughly **0.15 to 0.45 ms per call** on this machine (about 0.17 ms in the quieter run); with 4 clients the difference is inside run-to-run noise (direct 4.2 vs wrapper 4.3 ms; 5.8 vs 5.5 ms). The runs are noisy (a third attempt was killed by the container restart), so treat the figure as "sub-millisecond, small next to the network hop", not as a number to budget with. The gateway's extra HTTP hop and Vercel invocation are **Untested** (T20).

## 3. What failed or surprised (and what it changes)

1. **Invoker wrappers are impossible** (above). The design's A4 is answered locally; the "SECURITY DEFINER wrapper" in 6.4 is the only workable form.
2. **`public.apply_*` are SECURITY INVOKER routers** over four `private.apply_*` definer functions that `authenticated` can execute (USAGE on `private` is granted). The design lists only the two public names. The revocation migration must also revoke the four private functions, and the wrapper owner needs an explicit grant list on both schemas (the prototype's `gw_owner` list is in `20_wrappers.sql`).
3. **`service_role` is broader than F4/6.3.2 say** (model baseline): it holds EXECUTE on every authenticated RPC and read function, and **DML on all 36 public tables with RLS bypass**. Revoking function EXECUTE does not stop a leaked or old secret key from writing tables directly (shown: `UPDATE public.committees` succeeds as `service_role` after the function revocation). Revoking `INSERT/UPDATE/DELETE/TRUNCATE` on public tables from `service_role` works and the server-route wrappers still work (they run as definer), but a table created by any later migration is writable again through default privileges.
4. **Default privileges (A13) are real and drop-and-recreate re-exposes.** `CREATE OR REPLACE` keeps a revocation (no committed migration drops a function today, so existing ACLs have survived). `DROP FUNCTION` + `CREATE` and any new overload re-grant PUBLIC and the three API roles. A recreated definer write function (`submit_amendment` shown) is directly callable by `service_role` again. For `apply_*` the revoked private callee is a second ring that still denied the call. A drop-and-recreate also removes `gw_owner`'s grant, so the wrapper breaks (`permission denied`) until re-granted. Mitigation verified: `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role` plus `... REVOKE ... FROM PUBLIC`, after which DROP + CREATE stays closed, at the cost that every later migration must GRANT explicitly (a new read RPC was unreachable until granted). **Hosted default ACLs are Untested.**
5. **Argument digest must be over text.** The idempotency payload stored in `private.mutation_receipts` includes `client_time`; a retry must re-send the outbox's original `createdAt` (a regenerated timestamp gave `22023` in the first draft of the test). The wrapper therefore takes every argument as `text`, digests the exact bytes, then casts after verification. `timestamptz` and `uuid` text forms are session- and formatting-dependent, and exact JSON bytes are bound, so a gateway that re-serialises is refused rather than silently accepted.
6. **Wrapper owner needs plumbing grants.** A non-superuser owner of the wrappers needs USAGE on `public`, `private`, `lifecycle`; `lifecycle.args_digest` had to be SECURITY DEFINER because the owner has no access to `extensions` (pgcrypto), and definer helpers need USAGE on `auth` for `auth.uid()`. Hosted equivalents are Untested.
7. **Error codes and the client** (ISOLATION_DESIGN 9.1). `SupabaseTransport.send` maps `PT409`, `40001`, `42501` and classes `22/23` to a retained `ConflictError`, and everything else is classified by `classifyError` as "other" and retried on the network ladder indefinitely. A new `GW0xx` SQLSTATE would therefore **retry forever** instead of retaining the outbox with a clear message, and `42501` shows "Access has changed". A lifecycle refusal needs a small, reviewed change in `lib/supabase/repository.ts` (not `lib/sync`), or the gateway must translate codes. The jti reuse case also had to be converted from `unique_violation` (class 23 = conflict) to a dedicated code. The prototype never touched the client.
8. **Token floor boundary.** Floor is `ceil(now)` so tokens issued in the promotion second are refused until the next second; floor is raise-only. This relies on hosted access tokens carrying `iat` and `session_id` (**Untested**, A2/A6).
9. **Barrier simplified.** `lifecycle.transition` takes the freeze receipt fields and computes B itself, then refuses early; a person still supplies those inputs, so it guards mistakes, not fraud (as 4.1 already says).
10. Existing inconsistency, unchanged: `submit_amendment` raises `invalid_link` with SQLSTATE `22023`, `submit_resolution` with `P0001`; the clients match on message text only.

### Design corrections to ISOLATION_DESIGN.md

| Section | Correction |
| --- | --- |
| 1 F4, 6.3 inventory | Add `service_role` as an EXECUTE holder of every authenticated RPC and read function (default privileges), and the four `private.apply_*` functions; the public `apply_*` are INVOKER routers. T1 is now answered by the generated inventory |
| 6.3.2 "revoking the service-role bypass" | Function revocation does not stop a leaked `service_role` key writing tables (36 public tables, RLS bypass). Add a table-DML revocation (or key rotation as the control) and state which |
| 6.4 and A4 | State DEFINER wrapper as the only option; INVOKER fails on callee EXECUTE and on `lifecycle` USAGE (5.2). Record the owner grant list and that wrappers take text arguments |
| 6.4 digest | Digest over raw argument text, not typed values; the gateway must send `client_time` and the command bytes unchanged |
| 5.1 / 10 step 5 / A13 | Add: revoke the four `private.apply_*`; ship `ALTER DEFAULT PRIVILEGES` revokes (schema and PUBLIC) in the same migration or accept drop-and-recreate re-exposure; add a CI step running the inventory `--check`; any migration that drops a guarded function must re-grant `gw_owner` |
| 9.1 | New codes need an explicit client mapping (retained vs retried); default is retry forever. `jti` race must be `GW040` |
| 4.1 | The transition function can compute B from receipt inputs (done), still human-supplied |

## 4. Untested (needs hosted evidence or was not built)

Hosted `jwt_expiry`, token `iat`/`session_id` content and revocation behaviour (A1, A2, A6, T11, T24); Supabase Vault and pgcrypto availability and schema (`extensions`) (A10; the prototype stores keys in a table, D6b); PostgREST exposed schemas, HTTP status mapping of custom SQLSTATEs, named-argument resolution for the wrapper overloads, schema-cache reload (A3, A8); hosted `service_role` and default-ACL behaviour including whether the hosted `postgres` role (non-superuser) can run the revoke and `ALTER DEFAULT PRIVILEGES` (A13); Realtime after revocation (A9); event triggers (A7); real cached bundles and service workers (T10); Vercel scoping and retirement; capacity at Small (T20); the Next.js gateway route, CSRF controls and runtime-policy matrix (8.1), the signed register and attestation authority (section 4, A12), and the client error mapping. None of these was built here beyond the reference proof minter in `harness.ts`.

## 5. Proposed breakdown into small reviewable PRs

Assumptions: one engineer (Claude) working these full time with no other feature work; Codex independent review at about 1 working day per PR when the diff is small and 2 for schema/security PRs, partly overlapping the next PR; hosted preproduction access remains until cutover; the prototype SQL and tests are reused (about 30% of implementation already exists). Effort is engineer-days of focused work, not elapsed days. These are estimates, not commitments, and none is approved.

| # | PR | Depends on | Verification needed | Implement | Review (elapsed) | Rehearsal / hosted evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Additive migration: `lifecycle` schema, marker, log, key ring, token floor, `proof_uses`, `verify_proof`, 7 wrappers (phase `preproduction`, direct execute unchanged) | prototype | replay from empty; port of the 16 checks to `tests/*-db.test.ts`; inventory `--check`; typecheck, lint, `npm test` | 3.0 | 2.0 | 0.5 (apply once to preproduction, T1 live) |
| 2 | Gateway route `POST /api/sync/mutation` + `SupabaseTransport` change + new error mapping + CSRF/header controls; preproduction runtime policy | 1 | unit tests for headers/CSRF, error mapping, outbox retained on lifecycle refusal, existing sync tests unchanged; real browser | 4.0 | 2.0 | 1.0 (single device, then multi-device offline rehearsal through the gateway) |
| 3 | Submission, amendment and access-code routes onto the server-principal and user wrappers | 1 | extend `submissions-db`, `amendment-public`, access-code tests; T25 to T27 | 2.0 | 1.0 | 0.5 |
| 4 | Move `scripts/rehearsal/*`, `load-test`, `remote-*` onto the gateway with a `test` key | 2, 3 | harness dry runs; no hosted writes in CI | 2.0 | 0.5 | included in 8 |
| 5 | Revocation migration: revoke 11 functions, `service_role` table DML, `ALTER DEFAULT PRIVILEGES`; CI inventory check | 2, 3 and adoption of the gateway bundle on every device | prototype (e) checks as DB tests; T9, T10 old-bundle outbox retention | 1.5 | 1.5 | 0.5 live denial probes |
| 6 | Runtime policies, build/health fail-closed matrix (8.1), key-class custody per deployment | 2 | T23 matrix | 2.0 | 1.0 | 0.5 |
| 7 | Signed register, pinned keys, tool/build checks, attestation authority and barrier procedure (section 4) | none (parallel) | T3 to T5c with fakes | 4.0 | 1.5 | 1.0 (authority drill; hosting is owner's choice, D16) |
| 8 | Hosted evidence suite on `synthetic_locked` (T7 to T12, T16 to T18, T21, T22, T25 to T27), capacity run through the gateway at Small (T20) | 1 to 6 | dated results in `docs/VERIFICATION.md` | 1.5 | 1.0 | 3.0 (needs Small, owner spending approval) |
| 9 | Runbook and docs: cutover steps, wait-out (7.3), break-glass (D13), AGENTS/README alignment | 1 to 7 | independent read-through | 1.5 | 1.0 | 0.5 (cutover dry run on local/synthetic state) |

Totals: implementation about **21.5** engineer-days (about 14.5 without PR 7), review turnaround about 11.5 working days elapsed if reviews were strictly serial (4 to 6 realistically, since reviews overlap the next PR), rehearsal/hosted evidence about 7.5 days. The critical chain is 1 -> 2 -> (3, 4) -> adoption check -> 5 -> 8 -> cutover: about 12.5 implementation days plus review waits on 1, 2 and 5 plus 5 rehearsal days, so **about 18 to 22 elapsed working days**.

### Readiness against the freeze (Recommendation; the owner decides D1)

From 21 October there are 9 working days to the 3 November freeze (22, 23, 26 to 30 October, plus 2 November if worked). Even with an ideal run, the critical chain above does not fit: the earliest realistic completion of the **full** design (PRs 1 to 9) is about **mid-to-late November**, i.e. after the 5 to 7 November conference. The owner's proposed timeline (31 October Small load rehearsal, 1 November fixes, 2 November cutover) is only compatible with the load rehearsal itself being run through the gateway on the already-merged PRs 1 to 4 (about 11 implementation days plus reviews: earliest about 3 to 5 November on a perfect run, so **not** by 31 October), and leaves no slack for PR 5 (direct-execute revocation) or the evidence suite, which must finish before real data exists. Options to weigh, not decisions:

- **Reduced scope (D1 option b), about 8 to 9 implementation days:** PR 1, PR 3 and PR 5 plus the client error mapping, and the key-class/phase checks, with the register/attestation (PR 7) and the full runtime-policy matrix (PR 6) deferred and recorded as compensating controls (no hosted credentials outside Production, old deployments retired, wait-out applied). Realistic readiness roughly **30 October to 1 November** for code, with the Small load rehearsal after it, i.e. likely 1 to 2 November, leaving the 2 November cutover with no fix window. This needs the owner to accept the scope change in writing.
- **Full scope** requires moving the conference-data cutover, or accepting that the gates are not met and keeping the project closed to real data; the lifecycle document says to hold the cutover rather than make a test-access exception.

Assumption risks: hosted behaviour in section 4 may add days (PostgREST status mapping, Vault, default ACLs); Codex turnaround longer than 1 day per PR moves everything right; Small compute and the load rehearsal need owner approval for spending.

## 6. Reproducing

```
# start a disposable cluster as non-root (data dir under /tmp, not in the repo)
setpriv --reuid=65534 --regid=65534 --clear-groups /tmp/pg17x/bin/initdb -D /tmp/pg17feas/data -U postgres --auth=trust
setpriv --reuid=65534 --regid=65534 --clear-groups /tmp/pg17x/bin/pg_ctl -D /tmp/pg17feas/data -o "-p 54417 -c listen_addresses=127.0.0.1" -w start
export TEST_POSTGRES_URL=postgres://postgres@127.0.0.1:54417/postgres
npx tsx scripts/isolation-inventory/inventory.mts            # regenerate docs/generated (add --check to verify)
npx tsx --test prototypes/isolation/isolation.proto.test.ts  # 16 boundary checks
BENCH_SECONDS=10 npx tsx prototypes/isolation/bench.ts       # local overhead
```
