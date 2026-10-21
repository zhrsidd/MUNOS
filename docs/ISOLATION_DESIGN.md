# Single-project isolation: design for review

Written 21 October 2026 on `origin/main` `33a1592`. **This is a design for review. Nothing in it is implemented.** It changes no code, migration, Supabase project, Vercel setting, version or tag. It does **not** authorise a migration, any infrastructure change, any spending, or the cutover. Every migration, code change and configuration change it proposes still needs the owner approval and independent (Codex) review that [AGENTS.md](../AGENTS.md) and [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) require, and under the feature freeze each is an owner scope decision (checklist, "Owner-approval gates").

It answers one question: what exact contract would close the "Target safeguards" gates of [INFRASTRUCTURE_LIFECYCLE.md](INFRASTRUCTURE_LIFECYCLE.md) (the owner's 20 October decision, not edited here), so that a reviewer can accept, change or reject it **before** anyone builds it. It is the design behind checklist blockers B2 and B12 and rows 1.4.1 to 1.4.7.

## 0. What was and was not verified

Read for this document (repository only): the lifecycle document, the checklist (especially section 1.4 and the blocker table), `AGENTS.md`, `lib/platform/target-guard.ts`, `lib/platform/health-probe.ts`, `next.config.ts`, `scripts/rehearsal/guard.ts`, `lib/supabase/repository.ts` (`SupabaseTransport`), `lib/sync/repository.ts` (outbox flush and conflict handling), `lib/supabase/client.ts`, `lib/supabase/server.ts`, `app/api/health/route.ts`, `lib/submissions/backend.ts`, `lib/amendments/backend.ts`, `supabase/config.toml` and the migrations that define the write RPCs, `has_access`, `user_access` and `mutation_receipts`.

**Not done:** no test, typecheck or build was run for this design; no migration was run; Supabase, Vercel and GitHub were not contacted; no hosted behaviour was observed. Statements about hosted Supabase or Vercel behaviour are therefore listed as **assumptions to prove (A1 to A9, section 12)** and are never stated as fact. Statements about the repository are cited to a file and were read on the commit above.

## 1. Facts about the current system that drive the design

| # | Fact | Source read |
| --- | --- | --- |
| F1 | The target guard decides from **process environment only**: `EXPECTED_SUPABASE_REF`, `STAGING_SUPABASE_REFS`, `DEVELOPMENT_SUPABASE_REFS`. Only the PHESMUN ref is hard-coded as denied. An old shell or build that lists the ref as staging and omits `EXPECTED_SUPABASE_REF` is accepted. | `lib/platform/target-guard.ts` |
| F2 | The guard runs at build (`next.config.ts`), in the health probe, in the submission and amendment backends, and in operator scripts. It never reads the database. | `next.config.ts`, `health-probe.ts`, `lib/*/backend.ts` |
| F3 | The browser writes **directly** to PostgREST: `SupabaseTransport.send` calls `rpc('apply_conference_mutation' \| 'apply_operations_mutation', {conf, mutation, command, requested_role, expected, client_time})` with the publishable key and the user's session. | `lib/supabase/repository.ts` |
| F4 | `apply_conference_mutation` and `apply_operations_mutation` are executable by `authenticated`. The other authenticated-executable RPCs found in the migrations are: `conference_snapshot`, `conference_state_snapshot`, `executive_snapshot`, `executive_state_snapshot`, `operations_snapshot`, `staff_batch_snapshot`, `access_code_status`, `redeem_access_code`, `rotate_access_code`, `revoke_access_code`. `submission_link_info`, `submit_resolution`, `amendment_link_info`, `submit_amendment` are executable by `service_role` and are called from Next.js server routes holding `SUPABASE_SECRET_KEY`. This list comes from `grant execute` lines in the migrations; **a complete inventory must be taken from `pg_proc`/`has_function_privilege` on a replayed database** (section 11, T1). | `supabase/migrations/*` |
| F5 | In the one definition read (`20261006135232_nonretryable_stale_conflicts.sql`), `apply_conference_mutation` is `SECURITY DEFINER` with `search_path ''`, takes the actor from `auth.uid()`, returns the stored result for a repeated mutation UUID from `private.mutation_receipts`, and raises `PT409` or `40001` for stale `expected`. Later migrations redefine the functions; the current definition of each must be re-read at implementation. | migrations |
| F6 | `private.has_access(conf, committee, roles)` checks `auth.uid() is not null`, an unrevoked, unexpired `user_access` row, the role and the committee, on every call. Direct `user_access` reads are limited by RLS to the caller's own unrevoked, unexpired row. | `20261005103403_conference_foundation.sql` |
| F7 | The client maps `PT409`, `40001`, `42501` and SQLSTATE classes `22`/`23` to `ConflictError`. A `ConflictError` on the **head** of the outbox marks that item `conflict`, **blocks every action behind it** and **retains** all of them for export or review. Other errors are classified (network, overload, timeout) and retried with backoff using the same mutation UUID. | `lib/supabase/repository.ts`, `lib/sync/repository.ts` |
| F8 | The browser Supabase client is `createBrowserClient` from `@supabase/ssr`, which keeps the session in **cookies** that script can read. `serverClient` exists but no personalised server route uses it. | `lib/supabase/client.ts`, `server.ts` |
| F9 | `supabase/config.toml` (the **local** CLI configuration) lists PostgREST schemas `public` and `graphql_public` and sets `jwt_expiry = 3600`. The hosted project's values are not established by the repository. | `supabase/config.toml` |
| F10 | `/api/health` never contacts Supabase when `targetProblem` refuses the URL, and reports `down`. It reads process environment only. | `health-probe.ts`, `tests/target-guard.test.ts` (per checklist 1.3.10) |

Consequence: today nothing outside process configuration separates a Preview, a stale deployment or a test tool from the promoted project, and a holder of the publishable key plus any valid session can call the write RPCs directly from any origin. The lifecycle says exactly this does not meet its gate 6.

## 2. Threat model, goals and non-goals

**What is being protected.** After the recorded formal promotion the hosted project holds real conference data. The isolation must ensure that, from then on, writes and test tooling reach it only through human-controlled, Production-scoped paths, and that nothing created during preproduction (test credentials, test sessions, old Preview deployments, cached bundles, old allow-lists, cloud-agent access) can still act on it.

**Actors and capabilities assumed (all plausible mistakes or leaks, not only attackers):**

| Actor | Can | Examples |
| --- | --- | --- |
| P: stale or misconfigured Preview or old candidate deployment | holds an old `NEXT_PUBLIC_*` bundle, maybe an old server key; may be loaded by a staff member | an immutable deployment URL still alive after cutover |
| T: test or agent tooling | holds a publishable key, test user sessions, maybe an old secret key, and a shell with an old allow-list | load test, fixture or reset script from an old checkout |
| S: a real signed-in staff member in the wrong browser | holds a valid production session and signs in on a Preview or a spoofed page | lifecycle forbids reusing real staff sessions in Previews |
| X: any holder of the public key and URL | can call PostgREST and Auth from anywhere with arbitrary headers | curl, a script, a malicious page |
| O: a cloud agent with Supabase/SQL/MCP/Management API access | may act as a database owner-level role | removed at cutover step 3 |

**What the design can and cannot promise.**

1. It can make the **database** refuse writes that do not carry proof minted by Production-only code holding a Production-only secret, and refuse every credential and session issued before promotion. P, T and X lose the ability to write.
2. It **cannot** prove which browser bundle or origin a request came from. Any HTTP client holding a valid token can call a Production gateway the same way the Production app does. What the gateway adds is that the write is admitted by Production-runtime code that enforces the lifecycle, the actor's live grant, session validity and the operation; a legitimately authorised staff member's script performing a write they are already allowed to make is not an isolation breach. This is stated plainly so that nobody reads "Production-only" as "browser-bundle-only" (section 6.2).
3. The database marker **does not defend against a database owner-level role** (`postgres`, the dashboard SQL editor, the Management API or an agent connector that runs as one). Those can alter anything, including the marker. The lifecycle handles this by removing that access (cutover step 3) and by keeping the authority in a register outside the database; the design adds **detection** (an append-only transition log and a register-versus-database consistency check), not prevention (section 5.5).
4. Reads (snapshots and Realtime) remain direct from the browser. The lifecycle gate is a **write** boundary. A Preview holding a valid production session could still read what that user may read. This is a recorded residual risk handled by credentials never being present in Previews, not by this design (decision D8).

**Layers (each independent; none relies on another being correct):**

| Layer | Stops | Authority |
| --- | --- | --- |
| L1 Signed register (section 4) | tools and builds before any connection | owner's offline signing key |
| L2 Database lifecycle marker, key ring and token floor (section 5) | stale credentials, wrong-phase writes, pre-promotion sessions | database, changed only by a human-held role |
| L3 Write gateway plus proof (section 6) | direct RPC from anything that is not Production-runtime code | Production-only secret |
| L4 Revocation (section 7) | revoked users and sessions on every path | grants plus token floor, with a wait-out fallback |
| L5 Build, runtime and health fail-closed (section 8) | wrong deployments serving or probing | register plus process configuration |
| L6 Procedure: retire Previews, remove credentials, disconnect agents | O and old deployments | humans, per the lifecycle cutover list |

## 3. Vocabulary

- **Register**: the owner-signed document of section 4. Authority outside the database.
- **Marker**: the single-row lifecycle state inside the database (section 5).
- **Phase**: `preproduction`, `synthetic_locked` or `production` (see D3). `synthetic_locked` is how "production-classified **synthetic** state" required by the lifecycle's evidence list exists before promotion.
- **Epoch**: integer in the marker, incremented on every transition. Bound into every write proof.
- **Proof**: the short-lived MAC the gateway attaches to one write (section 6).
- **Token floor**: a minimum JWT issue time in the marker. Access tokens issued earlier are refused.

## 4. Gate 1: owner-controlled production deny-list and registry, usable without database access

**Contract.** A tool or build must refuse a known-production reference **before any connection**, using a document that (a) an agent or process cannot forge, (b) is not just process configuration, and (c) is fresh. An allow-list in an old shell must never re-authorise a promoted ref.

**Proposal.**

1. A JSON **register** with fields: `schema`, `seq` (monotonic), `issued_at`, `expires_at`, `signing_key_id`, and `refs`, a map from project ref to `{ class: "never" | "production" | "evidence" | "preproduction" , since, note }`. Refs are public identifiers (they appear in the URL), so the document holds no secret. PHESMUN's ref is `never`.
2. It is signed with an **owner-held offline Ed25519 key**. The matching public key (and a spare, to allow rotation) is pinned in the repository. Verifying needs no network and no database. The private key is never in CI, Vercel, a developer machine or an agent environment.
3. A copy is committed in the repository (changed only by an owner-approved, reviewed commit) so builds and CI can verify **authenticity** without network access. A committed or cached copy is evidence of what the owner signed at some time, **never** of what is current (4.1).
4. **Decision rule for every destructive, load, fixture, reset or verification tool (fail closed):** proceed only if all hold: the register verifies against a pinned key; it is not expired (`expires_at`) **and** a fresh head attestation confirms it is the latest register (4.1); a register copy alone never authorises a hosted target; the target ref is present with class `preproduction` (class `evidence`, the production-classified synthetic state of D3, is refused by every destructive, load, fixture and reset tool); the ref is also in exactly one nonproduction allow-list in the environment (the existing `targetConfig` rules stay: one role per ref, no override flag, exact `https://<20 chars>.supabase.co`). A ref that is absent, `production`, `never`, malformed, or any read, parse or signature failure refuses. The environment allow-list can narrow, never widen.
5. Tools also refuse a register whose `seq` is lower than the highest the machine has recorded locally. This is a convenience only: local state starts empty on a fresh checkout, so it is **not** a freshness guarantee. Freshness comes from 4.1.
6. At promotion the owner signs a new register with the ref as `production` **before** the database transition (section 10). Refusal then begins immediately and in the safe direction.

### 4.1 Freshness: what the offline check can and cannot prove

**The offline check proves only:** the document was signed by a pinned owner key, has not passed its `expires_at`, and says what it says for its own `seq`. **It cannot prove that no later register exists.** A valid, unexpired `preproduction` copy (for example seq 7 in a fresh checkout, expiring tomorrow) remains valid after the owner publishes seq 8 marking the ref `production`; signature, an age bound and a local highest-seq record do not change that. Database denial (L2) is a second layer and cannot provide refusal **before** contact. So the pre-contact refusal needs the two mechanisms below, and this design requires both (an authority check as the primary control, a promotion barrier as the backstop):

1. **Authority check (primary).** An owner-controlled **head attestation** service returns, for a caller-supplied random nonce, a signed statement `{ head_seq, head_digest, issued_at, nonce }` (also available as a pre-signed document for builds, with `issued_at` bound by `V_att`, proposed 15 minutes). It is signed by an **online attestation key** to which the offline owner key has delegated, by a signed delegation certificate with a short life (proposed 7 days) and a single capability: attesting the head. The attestation key can assert "the head is seq N" but **cannot create a register** (only the offline key can), so its compromise cannot promote or demote, and any new register seq revokes older delegations. A tool or build may treat a ref as `preproduction` **only if** it holds a valid register for that ref **and** a nonce-fresh (tools) or `V_att`-fresh (builds, and server routes at request time) attestation whose `head_seq` and `head_digest` equal that register. The register copy supplies the classification; the attestation supplies the proof that it is the latest.
2. **Promotion barrier (backstop).** No preproduction assertion may remain usable beyond `V_att` (the register copy alone is never one). The owner's promotion procedure is therefore: (a) stop issuing attestations and sign the `production` register (step 8, section 10); (b) real-data entry stays closed until the latest possible expiry of any preproduction assertion, `T_last_attestation + V_att + margin` (margin proposed 10 minutes), has passed; (c) in the same window the committed preproduction copies, CI caches and agent environments are purged or revoked where reachable (a procedure, not a proof, since every copy cannot be enumerated: the barrier is what makes stray copies harmless). If the attestation service is unavailable at promotion, the barrier time is computed from the last attestation actually issued, which the owner records; if that cannot be established, entry stays closed.

**When the authority is unavailable or stale (fail closed).** Any tool, build, health probe or server route that could contact or write to a ref that is **not provably non-production** refuses: no attestation, a stale one, a mismatched digest, a bad delegation or a network error all refuse, with no cached fallback and no override. Only targets with no hosted project (local demo, PGlite, local PostgreSQL 17) run without the authority, because there is nothing hosted to protect. PR and branch CI is local-only and needs no authority.

**What this still does not cover:** a deployment built and running before the change (old code does not check), which is why old deployments are retired and why L2, the `test` key revocation and the token floor exist; and a modified tool, as before. Where the authority is hosted, so that it is owner-controlled and available before the Production site exists, is decision D16. Nothing here is implemented, and the availability and behaviour of any hosted authority is an unverified assumption (A12).

**Why not simply an in-repository list or Vercel/Edge Config.** A repository file is editable by whoever holds the checkout, so a list supplied by an agent or process would be authority, which the lifecycle forbids. Vercel Edge Config would need a token in every tool and ties authority to a vendor the lifecycle already treats as a place credentials leak. Both are listed as options in D2.

**Not claimed:** a signed register cannot stop someone who edits the tool itself. It prevents the honest-mistake and stale-configuration cases, and it makes the safe path the default; L2 and L6 handle the rest.

## 5. Gate 2: server-enforced lifecycle lock and marker, inaccessible to test roles

Introduced only by a **reviewed, committed migration** (the next number; not applied or approved by this document), replayed from empty on local PostgreSQL 17, then applied once to the hosted project after owner approval. No existing migration is edited.

### 5.1 Schema (illustrative; names are not final)

```
schema lifecycle                      -- not in the PostgREST exposed-schemas list
  project_state                       -- exactly one row (primary key boolean default true, check (id))
    phase            text  not null   -- 'preproduction' | 'synthetic_locked' | 'production'
    epoch            bigint not null  -- +1 on every transition
    project_ref      text  not null   -- recorded by the operator; checked against the JWT issuer (A6)
    token_floor      bigint not null  -- minimum JWT 'iat' (seconds) accepted; 0 until set
    register_seq     bigint not null  -- seq of the signed register this state was promoted under
    changed_at, changed_by text, evidence_digest text
  transitions                         -- append-only: from_phase, to_phase, epoch, register_seq, operator, evidence_digest, at
                                      --   UPDATE/DELETE/TRUNCATE blocked by trigger
  gateway_keys                        -- kid text primary key, class ('test'|'evidence'|'production'),
                                      --   secret reference (Vault secret id, or a bytea column; D6), status, not_before, not_after
```

Rules enforced in the database, not in application code:

- **Transitions allowed only through `lifecycle.transition(...)`**, a `SECURITY DEFINER` function that: requires the operator role; checks the caller supplied the current epoch (optimistic, so a stale operator session cannot apply an old plan); rejects every transition not in the table below; writes `transitions`; bumps `epoch`.
- **Allowed transitions:** `preproduction -> synthetic_locked` and `synthetic_locked -> preproduction` (the latter only while `real_data_attested = false`, and only for the human operator); `synthetic_locked -> production` (sets `token_floor = now()`, activates the `production` key, revokes every `test` and `evidence` key in the same transaction). **There is no function and no code path from `production` to any other phase.** Demoting production is outside the application's contract: it would need a new reviewed migration or break-glass owner action, which is itself logged (5.5). This matches the lifecycle ("a phase name or allow-list supplied by an agent/process is not authority to demote production").
- A `check`/trigger rejects any direct `update`/`delete` on `project_state` outside `lifecycle.transition`.

### 5.2 Who can read and write

| Principal | `lifecycle` schema | Notes |
| --- | --- | --- |
| `anon`, `authenticated`, `service_role`, `authenticator`, any role created for tests, load or agents | **no `USAGE`, no table or function privilege, no RLS policy**; explicitly revoked, not merely not granted | verified by the privilege-matrix test (T2); the schema is not exposed to PostgREST so it has no HTTP surface (A3) |
| `lifecycle_operator` (new, `NOLOGIN` owner of the functions) | executes `lifecycle.transition`, key management | only reachable by a **separate login role whose password is held by trusted human operators** and never present in any agent, CI, Preview or shared environment |
| `postgres`, dashboard SQL editor, Management API, any agent connector acting as them | can bypass everything | the residual limit in section 2.3; mitigated by revoking those connectors (lifecycle cutover step 3), by 5.5 and by the register |
| Application functions (`gateway_*`, `has_access`) | read-only access through `SECURITY DEFINER` helpers | the application never reads the marker directly, and the browser never learns key material |

### 5.3 What the lock refuses (the "stale or misclassified credential" requirement)

Every write path (section 6.3 lists them) first calls `private.assert_write_allowed(...)`, which refuses when any of these hold:

1. the proof is missing, malformed, expired, or its MAC does not verify (6.4);
2. the proof's `kid` class is not accepted in the current phase: `preproduction` accepts `test`; `synthetic_locked` accepts `evidence`; `production` accepts `production`. A `test` proof presented to a production-classified database is therefore refused by the database even though the caller had a perfectly valid gateway at some earlier time (**this is how a stale test credential is rejected**);
3. the proof's `epoch` or `aud` (project ref) differs from the marker;
4. the caller's access token was issued before `token_floor` (**this is how a pre-issued session is rejected**, 7.2).

The same function is applied, through the wrappers, to `service_role` write paths (submission and amendment RPCs) so that an old secret key cannot write after promotion (D10).

### 5.4 How promotion is performed by a human (maps to lifecycle cutover step 6)

1. Preconditions, checked by `lifecycle.transition` and by the operator's runbook: the project is in `synthetic_locked`; the candidate SHA and migration ledger are frozen; synthetic data is removed; `real_data_attested` is set false and stays false until step 8; the signed register for the new `seq` already lists the ref as `production` (section 4.6).
2. The operator connects with the `lifecycle_operator` login (human-held), and calls `lifecycle.transition('production', expected_epoch, register_seq, evidence_digest)`.
3. In one transaction: phase, epoch, `token_floor`, key activation/revocation and the log row. The operator records the returned epoch and timestamp with the cutover evidence (operator, approvals, ref, candidate SHA, ledger, backup, access-revocation evidence), as the lifecycle requires.
4. Production-scoped secrets (including the production gateway key, which the human generates and installs, never an agent) are installed in the Production environment **after** the transition, in the same write-pause window, then the production build is released and verified (section 10).

### 5.5 Tamper detection (not prevention)

- `transitions` is append-only with a hash chain (each row stores a digest of the previous row and its own content); the register stores the digest of the latest transition the owner expects. The Production gateway and the human health check compare the two and **refuse writes and report loudly** on mismatch. This detects an out-of-band change by an owner-level role; it does not prevent it.
- An event trigger that logs DDL touching the `lifecycle` schema, and a periodic human review of Supabase audit/Logs, are proposed as detection; whether the event trigger can be created and is not disabled by hosted restrictions is an assumption to prove (A7).

## 6. Gate 3: production-only write gateway and capability

### 6.1 Contract

All accepted writes pass through a Next.js server route that runs only in the Production deployment, authenticates the **actual** actor and session, rejects cross-site requests, and attaches a short-lived proof bound to the exact operation. The database accepts the write only with such a proof, and **direct calls to the existing write RPCs are denied to every role**. The actor stays the user: the caller's own JWT is forwarded to the database so `auth.uid()`, `has_access`, committee scoping, revocation and the mutation receipts all run exactly as today. No service key reaches the browser, and no blanket privileged write replaces an actor check.

### 6.2 Why headers, keys and client flags are not proof

| Signal | Why it is not proof |
| --- | --- |
| `Origin`, `Referer` | Set by the browser for browser requests only. Any script, `curl` or server-side code sets any value. A cross-site page cannot forge them in a browser, but that protects users from other sites (CSRF), not the database from a client that is not a browser. |
| CORS configuration | A browser-enforced read restriction. It never stops a request from being sent and means nothing to a non-browser client. |
| The publishable key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) | Public by design and embedded in every bundle, including every cached and Preview bundle. |
| A client-side phase or environment flag (`NEXT_PUBLIC_BUILD_ENV`, a header such as `x-vercel-env`) | Chosen by the caller. Spoofable by definition. |
| A valid user session | Proves who the user is, not which deployment is calling. The lifecycle's own example (a Preview holding a valid production session) is exactly the case this must stop. |

The only thing the database can verify without trusting the caller is a **secret the caller must hold**. The proof is a MAC under a key that exists only in the Production runtime environment and in the database key ring. A Preview or test tool does not have it. What this proves is "written through code that holds the Production key", **not** "written by the Production browser bundle" (section 2.2); the first is the property the lifecycle needs.

### 6.3 Write paths that must be gated, by function family

**Source of this inventory.** Read for this revision: the `create function` and `grant execute`/`revoke` statements in `20261005103403_conference_foundation.sql`, `20261006023101_operations_extensions.sql`, `20261006023108_operations_review_hardening.sql`, `20261006023111_chair_procedure.sql`, `20261006135232_nonretryable_stale_conflicts.sql`, `20261007104500_access_code_redemption.sql` and `20261007104501_staff_schedule_amendments.sql`, and the calling code in `lib/access-codes.ts`, `lib/submissions/supabase-backend.ts` and `lib/amendments/backend.ts`. Signatures below are the ones in those `grant`/`revoke` lines. This is **not** a complete inventory: T1 must produce it from `pg_proc` and `has_function_privilege` on a replayed database, and every gated function must be added to the table before the migration is reviewed. Nothing that was not read is listed as read.

The gated functions do **not** share one identity or one idempotency mechanism, so there are three proof profiles. Each family states its identity, its replay behaviour today, and how the proof binds to it.

| Family | Functions (real signatures) | Caller today | Identity used | Replay or idempotency today | Proof profile and binding |
| --- | --- | --- | --- | --- | --- |
| M: staff mutations | `apply_conference_mutation(conf uuid, mutation uuid, command jsonb, requested_role conference_role, expected text, client_time timestamptz)`; `apply_operations_mutation` (same six arguments) | browser, `authenticated` | `auth.uid()`, then `has_access` | client-generated mutation UUID, stored in `private.mutation_receipts`; `PT409`/`40001` for stale `expected` | **UP-M** (6.4): every one of the six arguments bound; user JWT and session required |
| A: access codes | `redeem_access_code(conf uuid, code text)`; `rotate_access_code(conf uuid, requested_role conference_role, committee uuid, expires_at timestamptz)`; `revoke_access_code(conf uuid, credential uuid, revoke_devices boolean)` (all `authenticated`; `access_code_status(conf uuid)` and `staff_batch_snapshot(conf uuid, include_amendments boolean)` are reads, unchanged, D8) | browser, via `lib/access-codes.ts` | `auth.uid()`: `redeem` needs only a session (an anonymous Supabase Auth identity with no grant yet; the code is the authority); `rotate`/`revoke` additionally require an Executive grant through `has_access` | **No mutation UUID.** `redeem` upserts `user_access` and `private.access_grant_sources` and appends `private.access_redemption_attempts`; it is rate limited to 8 failures per actor and conference per 10 minutes, and repeating it is an effect-idempotent upsert (it also refreshes expiry and clears `revoked_at`, existing behaviour). `rotate` and `revoke` create `gen_random_uuid()` credential and audit ids on each call; I did not read whether a repeated `rotate` is otherwise harmless, so it is treated as **not idempotent** | **UP-A** (6.3.1): all arguments bound; user JWT and session required; **single-use proof** (`jti`) for `rotate` and `revoke` |
| S: public link submissions | `submit_resolution(link_token text, submission uuid, submitter uuid, title text, google_doc_id text, file_name text, storage_key text, file_sha256 text, file_size integer)`; `submit_amendment(link_token text, submission uuid, submitter uuid, resolution uuid, amendment_type text, clause text, wording text)`. Reads `submission_link_info(link_token text)` and `amendment_link_info(link_token text)` (service role) | Production server routes with `SUPABASE_SECRET_KEY` (`lib/submissions/supabase-backend.ts`, `lib/amendments/backend.ts`) | **none**: delegates are intentionally unauthenticated. Authority is possession of an active, unrevoked link token plus the delegate and committee data checked inside the function; there is no `sub` and no `session_id` | `submission` UUID: advisory lock; `private.resolution_submissions` / `private.amendment_submissions` store the payload, a repeat returns `replayed`, a repeat with different details raises `idempotency_conflict`; duplicate detection; per-link rate limit (20 per 10 minutes) | **SP** (6.3.2): all arguments bound; **no** user JWT or session; server principal |

The tables whose grants were read (for example `user_access`, `conferences`) give `authenticated` `select` only; I did not read every table's grants, so T1 must confirm that no table or function gives `authenticated` or `service_role` another mutating privilege. Read functions are unchanged (D8).

#### 6.3.1 User-principal profiles UP-M and UP-A

Both use the mechanism of 6.4 (user JWT forwarded, `auth.uid()` unchanged, proof bound to actor, session, project, epoch and arguments). They differ only in what the arguments are and in replay:

- **UP-A argument binding.** `args_digest` covers `fn` and **every actual RPC argument in signature order**, each with a type tag and an explicit NULL marker (so NULL and empty string differ). For `redeem_access_code` the digest covers the code through its SHA-256, so the proof never carries the code. The gateway receives the raw code in transit exactly as PostgREST does today and must not log it.
- **Single-use proofs for non-idempotent calls.** `rotate_access_code` and `revoke_access_code` have no receipt, so a replay of a still-valid proof would repeat the effect. Their proofs carry a random `jti`; the wrapper records it in a small append-only `lifecycle.proof_uses` table (pruned after `exp`) and refuses a second use. `redeem_access_code` and `apply_*` are replay-safe by their own mechanisms and do not need it. The gateway never retries these calls by itself; the UI already reports that revocation could not be confirmed.
- **Why redemption is gated at all.** `redeem_access_code` writes `user_access`, i.e. it creates authority. Left directly executable, a Preview holding an anonymous session and a leaked valid code could create a production grant. D17 records this choice.
- The wrapper calls the **existing** function unchanged, so Executive checks, committee locks, rate limiting and the credential and audit behaviour are the same code as today.

#### 6.3.2 Server-principal profile SP

The public submission and amendment flows have no end user, so the user-principal checks (Bearer token, `sub`, `session_id`, `auth.uid()`) cannot apply. SP replaces them as follows.

- **Principal.** The caller is the Production server route, authenticated to the database as `service_role` (the existing secret key, held only by Production-scoped runtime configuration) **and** by a proof with `typ = server` and a fixed `sub` naming the route family (for example `route:submissions`, `route:amendments`). The wrapper requires both the `service_role` identity and a proof whose `kid` class is accepted for the phase (5.3). No `session_id` is required or accepted.
- **Argument binding.** `args_digest` covers `fn` and **all** of the arguments in the signature order above, each type-tagged with explicit NULL: nine for `submit_resolution` (`link_token`, `submission`, `submitter`, `title`, `google_doc_id`, `file_name`, `storage_key`, `file_sha256`, `file_size`) and seven for `submit_amendment` (`link_token`, `submission`, `submitter`, `resolution`, `amendment_type`, `clause`, `wording`). `link_token` is a bearer secret and enters the digest only as part of the hash, never in the proof. The code read in `lib/submissions/supabase-backend.ts` passes NULL for the file fields on the Google Doc path; the digest must keep that NULL distinct from an empty string.
- **What is preserved untouched** because the wrapper calls the existing function: active-link check, committee and archive state, delegate-belongs-to-committee check, the `submission` advisory lock, `replayed`/`idempotency_conflict`, duplicate detection and the per-link rate limit of 20 per 10 minutes. The route's own bounded body, validation and `Cache-Control` behaviour are unchanged.
- **Replay.** A replayed proof carries identical arguments, so the function returns `replayed` through its own idempotency record; no `jti` table is needed.
- **Honest limits.** SP has no user factor. A holder of the production key can mint proofs for arbitrary arguments, but each still needs a valid, unrevoked link token (and matching delegate data) for the function to accept it, so possession of the key alone is not enough to submit. CSRF does not apply: there is no ambient credential, the link token travels in the request body. Origin and Referer are still not proof. Per-IP abuse limits remain the existing route and database rate limits; this design adds none.
- **Revoking the service-role bypass.** The wrappers are the only way to write: `execute` on `submit_resolution` and `submit_amendment` is **revoked from `service_role`** (it is already revoked from `public`, `anon` and `authenticated` in the migrations read), and the wrappers' `execute` is granted to `service_role` and used only by the Production server routes. The read functions `submission_link_info` and `amendment_link_info` stay executable by `service_role` for the routes (read-only; D8 reasoning). An old secret key, a Preview or a test tool that still holds a valid key then gets `permission denied` on the writes. Whether the hosted `service_role` retains execute on new functions through default privileges is an assumption to prove (A13); T1 checks the live grants.
- **Ordering.** See section 10: the routes are changed to call the wrappers (step 4) before the migration that revokes the direct `service_role` and `authenticated` execute (step 5); old deployments still calling the direct functions are retired or refused, never kept alive by an exception.

### 6.4 Mechanism (recommended option G1; others in D4). This section defines profile UP-M; UP-A and SP are in 6.3.1 and 6.3.2

**Route.** One new Production-only route, for example `POST /api/sync/mutation`, used by `SupabaseTransport.send`. It accepts the same fields the transport sends today (`conf`, `mutation`, `command`, `requested_role`, `expected`, `client_time`) and returns the database's error code and message unchanged so the existing classification keeps working (section 9).

**Authenticating the actor and session.**

1. The client sends the user's **access token in an `Authorization: Bearer` header** (from `auth.getSession()`), never relying on cookies as the credential. This is the main CSRF control: a cross-site page cannot make the victim's browser attach it.
2. The route validates the token server-side against Supabase Auth (`getClaims`/`getUser`, as `lib/supabase/server.ts` already anticipates), requires the `sub` and `session_id` claims, and requires that the token's `iss` matches the expected project. Whether Auth rejects an access token whose session was revoked is assumption A2 and is **not relied on** (the database floor and grant checks are).
3. The route refuses to run unless its own process passes the existing `targetProblem` check **and** its **runtime policy** (section 8.1: `production`, `evidence` or `preproduction`) agrees with the verified register's class for the ref and with the key class it holds. The Production policy needs register class `production`; the preproduction and evidence policies exist only so the gateway can be rehearsed and are separately approved (D15). This is an additional software check, **not the control**: the control is the key class the database accepts.

**CSRF.** Bearer-header authentication; a custom header and `Content-Type: application/json` (forces a CORS preflight); no `Access-Control-Allow-*` response headers (cross-origin requests are blocked by the browser); reject requests with `Sec-Fetch-Site: cross-site` and an unexpected `Origin` as defence in depth. These stop cross-site browser attacks and are **not** the isolation control. Cookie-only requests are rejected.

**Minting the proof.** After authentication the route computes and attaches:

```
proof = v | typ(user|server) | kid | aud(project ref) | epoch | sub | session_id (user only) | jti (single-use calls) | fn | args_digest | iat | exp(<= 60 s) | mac
mac   = HMAC-SHA256(key[kid], canonical string of every field above)
args_digest = SHA-256 over length-prefixed, type-tagged bytes of: fn, then EVERY actual RPC argument in signature order with an explicit NULL marker
              (UP-M: conf, mutation, command as the exact text sent, requested_role, expected, client_time; UP-A and SP: see 6.3)
```

The command travels to the database as text so the digest covers the exact bytes (no JSON canonicalisation mismatch); the wrapper casts it to `jsonb` after verifying.

**Database side.** New wrapper functions (for example `public.gateway_apply_conference_mutation(..., proof text)`) are executable by `authenticated`. Each: verifies the MAC with the key ring (class acceptable for the phase, `kid` active, not expired), checks `aud`, `epoch`, `sub = auth.uid()`, `session_id` equals the JWT's, recomputes `args_digest` from its own arguments, applies the token floor, then calls the **existing** function unchanged. `EXECUTE` on the existing `apply_*` functions is **revoked from `anon`, `authenticated` and `public`**. The wrapper runs `SECURITY DEFINER`, so it can call the existing function; the existing function still reads `auth.uid()` from the request's JWT claims, so the actor, RLS-equivalent scoping, per-user, conference, committee and revocation checks, the `private.mutation_receipts` idempotency and `PT409`/`40001` handling are the same code as today. Whether the retained caller identity is visible to the callee inside a definer wrapper is an assumption to prove locally (A4; T6).

**Preview-minted proof refused.** A Preview has no production key. It can hold at most a `test` key (preproduction) which the database refuses once the phase is `synthetic_locked` or `production`. A proof is bound to `aud`, `epoch`, the actor and session, the function and the exact arguments, so it cannot be reused for another operation, actor, project or phase, and replay of the **same** proof can only repeat the **same** mutation, which the receipts make idempotent.

**Key custody.** The production key is generated by a human at promotion, held in Production-scoped runtime configuration and the database key ring only (Vault if available, D6), is never in `NEXT_PUBLIC_*`, a repository, CI, Preview or agent environment, and is rotated by the human operator. A leaked **proof** is worth at most 60 seconds for one already-authorised mutation. A leaked **key** lets its holder mint proofs but still needs a live, correctly scoped user token for each write, which is the reason G1 keeps the user's own JWT as the identity rather than a service key (G2 rejected).

### 6.5 Preserved semantics (explicit checklist for review)

| Semantic | How preserved |
| --- | --- |
| Per-user identity | The user's JWT is forwarded; `auth.uid()` unchanged. The gateway never asserts an actor to the database. |
| Conference, committee, role scoping | Existing function bodies unchanged and still called. |
| Revocation | `has_access` checks every call; plus token floor and session claim (section 7). |
| Mutation UUID and idempotency | The UUID is generated by the client when the action is queued (outbox), passed through unchanged, stored in `private.mutation_receipts`. The gateway holds no state, never creates or rewrites a UUID, and never retries by itself on an ambiguous result. |
| `PT409` and `40001`, optimistic fingerprints (`expected`) | Passed through verbatim in status and code. |
| Durable outbox | Unchanged. The outbox stores the mutation, **not** the proof; a proof is minted at each send attempt. Offline work never expires because of a proof. |
| No service key in the browser | The gateway holds only a MAC key and calls PostgREST with the user's token and the publishable key. `SUPABASE_SECRET_KEY` remains only in existing server routes. |
| No blanket privileged writes | No `service_role` write on behalf of users is introduced (G2 rejected). |

### 6.6 Costs and risks of G1 (for the reviewer to weigh)

- **New availability dependency.** Writes now need the Production function as well as Supabase. The outbox absorbs short outages; a Vercel outage during the conference becomes a write outage. A human break-glass path must exist (D13): direct SQL by an authorised human, not a client flag.
- **Capacity.** One extra hop per mutation. The 110-device/19-committee run must be repeated through the gateway at Small; Vercel invocation cost is a spending question this document does not authorise.
- **Wrapper surface.** Every gated function needs a wrapper and a test that wrapper and original agree. Redefining the originals is avoided on purpose.

## 7. Gate 4: JWT and session revocation

**Contract (lifecycle cutover step 4).** Revocation must be immediate in all RPC, read and write paths. If immediate session-level rejection cannot be **proved**, wait out the remaining token validity before real-data entry.

### 7.1 What exists

Grant revocation: `has_access` and the `user_access` RLS policy check `revoked_at` and `expires_at` per call (F6), so deleting or revoking a **grant** takes effect on the next call for every path that goes through them. That is read from migration 1 only; T8 must prove it for **every** RPC, read and Realtime path from the T1 inventory rather than assume it.

What does not follow: revoking a **session** or deleting a **user** does not by itself invalidate an access token already issued. Supabase documents access-token lifetime as the validity window (A1: hosted `jwt_expiry` is unverified; the local config says 3600 seconds).

### 7.2 Proposal

| Layer | Behaviour | Proved where |
| --- | --- | --- |
| R1 grant check | unchanged, plus an explicit test for every path | local PG17 (T8) |
| R2 **token floor** | `lifecycle.project_state.token_floor`; the wrapper and `has_access` reject a JWT whose `iat` is lower. Set to `now()` at promotion, and raisable by the human operator for an incident. Because a refresh issues a new token with a newer `iat`, the floor alone is not session revocation: it is paired with R3. | local PG17 with synthetic claims; hosted for real Auth tokens |
| R3 session revocation by a human | at cutover step 3 the operator signs out/revokes all sessions and refresh tokens (Auth admin action) before the floor is raised; with refresh revoked and the floor raised, an old access token is refused by the database and cannot be replaced | hosted only (A2) |
| R4 optional per-session check | `session_id` must still exist in Auth's session store | only if A5 shows the function can read it and the cost is acceptable; see D7 |
| R5 optional central enforcement | a PostgREST pre-request function applies phase and floor to every API request (RPC and table reads) in one place | only if A8 shows it is supported and measured acceptable; see D7 |
| Realtime | existing channels re-authorise on `setAuth`; whether a revoked or floor-rejected token stops receiving events must be tested on hosted (A9) | hosted |
| Legacy keys | legacy API keys are separate long-lived credentials; the owner confirms which key types exist, disables or rotates legacy ones, and records it. Not designed further here. | dashboard, owner |

### 7.3 Wait-out rule (fallback, binding)

Real-data entry does not open until **either** hosted evidence proves, with a pre-issued access token from a revoked session, denial on all of: a read RPC, a table read, a gateway write, a direct write attempt and a Realtime subscription; **or** the operator waits until a **bound on the latest possible expiry of every access token issued before revocation** has passed, plus a margin. The current `jwt_expiry` setting is not that bound: tokens already issued keep the lifetime they were issued with, so a setting later reduced (for example from 3 hours to 1 hour) does not shorten them. The Supabase documentation says an unexpired JWT can remain valid after its session is revoked ([server-side advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)).

Procedure: (1) stop all issuance and refresh first (revoke refresh tokens and sessions, disable sign-in paths) and record the instant `T_stop`; (2) establish `L_max`, the longest lifetime any pre-revocation token could have been issued with, from **actual `exp` evidence** (for example the largest `exp` seen in Auth logs or sessions) or, failing that, a **conservative historical bound**: the maximum `jwt_expiry` the project has had since creation, which the owner must be able to document from the dashboard and change history; (3) the earliest opening time is `T_stop + L_max + margin` (proposed margin 10 minutes; the owner may set a larger one). **If `L_max` cannot be established, real-data entry stays closed**; the local 3600 s default is not an acceptable substitute. `T_stop`, `L_max`, the evidence for it and the opening time are recorded with the cutover evidence. The wait-out is the default and is **not** replaced by an untested claim.

## 8. Gate 5: Preview, build and runtime fail-closed; health

**Build.** `next.config.ts` keeps its current checks and adds: after the existing process checks, the register is loaded and verified from the committed copy **and** a fresh head attestation (4.1) is obtained. The build **fails** if: the register is missing, unverifiable or expired; the attestation is missing, stale, mismatched or unavailable and the ref is a hosted project; the configured ref is `never` or `production` and `VERCEL_ENV` is not `production`; or `VERCEL_ENV=production` and the register does not mark the ref `production` with the expected `EXPECTED_SUPABASE_REF`. An old allow-list can no longer re-authorise a promoted ref because the register, not the environment, has the last word.

### 8.1 Runtime policies and the complete guard/key matrix

The gateway cannot be rehearsed if only a production-classified deployment may run it, so three runtime policies exist. A policy is set by owner-approved deployment configuration and baked into the build identity; it is a **software fail-closed guard, never proof** (6.2). The database's key-class check (5.3) is the control. Deployment types: **PROD** (Vercel Production, public), **APPR** (an owner-approved, protected deployment of the exact candidate, or a local run, that holds the nonproduction key for its policy), **PREVIEW** (any other Preview, branch, old or immutable deployment: no hosted values, no key, no policy). Builds additionally fail if `VERCEL_ENV=production` and the policy is not `production`, and if `VERCEL_ENV` is not `production` and the policy is `production`.

| # | Deployment | Policy | Register class of ref | Marker phase | Key class presented | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | PROD | production | production | production | production | **allowed** |
| 2 | PROD | production | preproduction or evidence | any | any | denied (build and runtime) |
| 3 | PROD | production | production | not production (marker and register disagree, 5.5) | production | denied |
| 4 | PROD | preproduction or evidence | any | any | any | denied (strict Production denial; build fails) |
| 5 | APPR | preproduction | preproduction | preproduction | test | **allowed** (rehearsal, load, capacity) |
| 6 | APPR | preproduction | preproduction | synthetic_locked or production | test | denied by the database (key class not accepted) |
| 7 | APPR | evidence | evidence | synthetic_locked | evidence | **allowed** (production-classified synthetic positive controls) |
| 8 | APPR | evidence | evidence | preproduction | evidence | denied (phase/register mismatch) |
| 9 | APPR | evidence | evidence | synthetic_locked | test | denied (**Preview- or test-minted proof**) |
| 10 | APPR | any nonproduction | production | any | any | denied |
| 11 | APPR | any | any | production | test or evidence | denied (keys revoked at promotion) |
| 12 | PREVIEW | none | any | any | none (no key, no gateway) | denied by software; direct RPC denied by the database after the direct-execute revocation |
| 13 | PREVIEW with a copied `test` key | n/a | any | synthetic_locked or production | test | denied by the database; in `preproduction` it is accepted, which is why the `test` key lives only in APPR environments and is revoked on entering `synthetic_locked` |
| 14 | any | any | any | any | production key but marker not production | denied |

Key custody follows the matrix: the `test` key exists only in APPR preproduction configuration; the `evidence` key only in the single APPR evidence deployment or a local evidence run, created on entering `synthetic_locked`; the `production` key is created by a human at promotion and never earlier. Table rows 5 and 7 are the only positive paths before promotion, and every synthetic positive-write check (including submission and amendment credentials, T21) happens there.

**Server runtime.** Every server route that can reach the project (gateway, submissions, amendments, health) runs the same check at request time, not only at build time, so a deployment configured at build for one state and later reclassified refuses without a rebuild. A refused request contacts nothing.

**Health.** `probe()` order is: process-level `targetProblem`, then the register check, then (only if both allow) contact. A refused or unverifiable target returns `down` with "Wrong Supabase project" and performs **zero** network calls, matching the current behaviour for the process check (F10). The marker is **not** read by health on a refused target; for an accepted target, whether health may read a coarse marker-versus-register consistency flag is left to review (it would be a database contact, so it is only on the accepted path).

**Old bundles in the browser.** Already-built bundles cannot be changed. The design relies on them failing at the database (they call a revoked direct RPC, 7.1/section 9), not on their own checks. New bundles additionally refuse to create a Supabase client when their baked build identity (`NEXT_PUBLIC_BUILD_ENV`) and the baked register digest disagree; this is user-experience safety, explicitly **not** proof.

**CI.** PR and branch CI stays local-only and receives no production secrets (existing, checklist 1.3.11). The register's public key is not a secret.

## 9. Compatibility with durable sync, `PT409` and idempotency

1. **Error contract.** The gateway returns `{ code, message }` with the HTTP status the database error had (`PT409` as 409, `40001` as 409, `42501` as 403), so `SupabaseTransport.send` keeps `ConflictError`/`transportError` classification. New gate-specific codes are added and **must not be mapped to `ConflictError`** unless they are non-retryable by design: proof expired or clock skew and gateway 5xx are retryable (backoff, same mutation UUID); `lifecycle` refusals are non-retryable and should surface a clear "this device is not allowed to write to this project" message that retains the outbox.
2. **Old cached bundle after direct execute is revoked.** It receives `42501`, which the current client maps to a conflict: the head item becomes `conflict`, everything behind it waits, and **nothing is lost**, but the outbox is blocked until a human exports or dismisses it (F7). This is acceptable only **because all such devices hold synthetic data** and their outboxes are reconciled before cutover (lifecycle step 2). It is why revoking direct execute is a **separate, later** step (section 10) and why test T10 asserts the old bundle's saved actions are retained, not dropped or applied twice.
3. **Retry of the same mutation.** A timeout after the database committed is retried with the same UUID; the wrapper verifies a fresh proof for the identical arguments and the receipt returns the stored result. If the retry's proof differs only in `iat`/`exp`, the arguments digest is unchanged, so the receipt matches.
4. **Offline.** Nothing about the proof is persisted in IndexedDB; an offline device keeps its own mutations, re-authenticates its session on reconnect, and mints a new proof per attempt.
5. **No new write path** bypasses the outbox. The gateway is the transport's endpoint, not a second queue.
6. **Service worker.** `/sw.js` is already `no-cache` (`next.config.ts`), so devices pick up the gateway-capable bundle on their next load; the rollout still verifies adoption instead of assuming it (T10).

## 10. Rollout and rollback ordering

Each numbered step is a **separate approval** (owner, plus independent review for protected areas). Nothing here is approved by this document.

**Build and rehearse (preproduction, synthetic data; destructive and load tests complete before step 5):**

1. Owner decisions D1 to D17 (section 12) recorded.
2. Register and tooling change (L1) merged: signed register, pinned keys, tool and build checks. No database change. Tested locally (T3 to T5).
3. **Additive migration** (marker, transitions, key ring, token floor, `assert_write_allowed`, wrapper functions; phase `preproduction`; direct execute still granted so nothing existing breaks): reviewed, replayed from empty locally, applied once to the hosted project.
4. Gateway route and `SupabaseTransport` change, with the **preproduction** runtime policy (8.1 row 5) deployed only to separately approved APPR deployments; the load/rehearsal harness (`scripts/rehearsal/*`, `scripts/load-test.mts`, `scripts/remote-*.mts`, which call RPCs directly today) is moved onto the gateway with a `test` key, so rehearsals exercise the real path. Re-run capacity at Small through the gateway (checklist 1.8). The submission and amendment routes call the server-principal wrappers (6.3.2) and the access-code calls move to the gateway (6.3.1), with the same `test` key.
5. Verify on **protected preproduction deployments** that every device and Preview that matters runs the gateway-capable bundle. Then a **second small migration** revokes direct execute on the gated functions. It is separate so it can be sequenced after adoption and so a rollback does not require re-editing an applied migration (re-granting would be a new forward migration). That migration also revokes `service_role` execute on `submit_resolution` and `submit_amendment` and `authenticated` execute on the access-code write functions, leaving only the wrappers; the delegate-link and access-code flows are re-tested immediately afterwards (T21, T25 to T27).
6. Owner signs a register with the ref as class `evidence`; then enter `synthetic_locked` (human, `lifecycle.transition`), which revokes the `test` key; install the `evidence` key and deploy the **evidence** runtime policy to the single APPR evidence deployment (8.1 rows 7 to 9, 11). All load, capacity and destructive runs must already be complete. Run the full evidence suite of section 11 (production-classified synthetic state). Do the guarded synthetic cleanup (lifecycle cutover step 2). If evidence fails, demote to `preproduction` (allowed only here), fix, repeat.

**Cutover (the lifecycle's formal cutover; writes paused):**

7. Lifecycle steps 1 to 5 (freeze SHA and ledger, reconcile and remove synthetic data, disconnect agent access, revoke test credentials and sessions per section 7, retire connected Previews and aliases).
8. **Owner signs register `seq+1` marking the ref `production`** and stops issuing preproduction attestations. Tools and builds refuse it once their last attestation lapses (`V_att`); the **promotion barrier** of 4.1 applies: real-data entry stays closed until `T_last_attestation + V_att + margin` has passed and reachable preproduction copies are purged. (Safe direction first.)
9. Human `lifecycle.transition('production', ...)`: bumps epoch, raises the token floor, revokes `test` and `evidence` keys, activates the production key. Record evidence.
10. Human installs the Production-only expected ref, configuration and gateway key; release the approved production build from the verified SHA; human, non-destructive checks of target, SHA, health and denial of old access (lifecycle step 7). No synthetic or destructive suite runs after this point.
11. Wait-out or hosted proof per 7.3, then real-data entry (lifecycle step 8).

**Failure handling.** If step 9 fails, the register already says `production` and the database does not: every tool and build refuses, and the gateway refuses writes because marker and register disagree (5.5). The project stays closed to real data; correction, not a temporary exception. If step 8 was signed and step 9 cannot proceed, the owner signs a higher `seq` only while the database is still `synthetic_locked` or `preproduction`. After step 9 there is no demotion.

**Application rollback** is only to a build that is gateway-capable and was created **after** key rotation (a Vercel deployment keeps the environment it was built with, so an older deployment holds an old key, `test` or revoked, and its writes will be refused; this matches the lifecycle's note that a credential-rotated rollback deployment can only be created after rotation). Application rollback never undoes migrations, never demotes, and never resurrects connected Previews or old allow-lists. Pre-gateway builds are **incompatible** once step 5's migration is applied; the known-good list must say which builds are gateway-capable.

## 11. Test plan: proving each gate on production-classified synthetic state

**Principle.** Every negative test needs a positive control from a **valid, active, correctly scoped grant** (checklist 1.4.4 requires this), otherwise "denied" may only mean "revoked" or "mis-scoped". All destructive, load and write-isolation testing completes before real data exists. After promotion only human-run, non-destructive checks remain.

**Where each kind of test can run:**

- **Local PG17** (the existing `tests/*-db.test.ts` harness against local PostgreSQL 17 and PGlite): everything that is database logic, using synthetic JWT claims through `request.jwt.claims`.
- **Hosted, `synthetic_locked`, agent-runnable** (the project still holds synthetic data and agent test access exists; negative probes and a few synthetic writes): everything that needs real Supabase Auth, PostgREST roles, Vault and Vercel behaviour.
- **Hosted, after promotion, human-run, non-destructive:** read-only target, SHA, health and denial checks (no writes).

| ID | Test | Expected | Local PG17 | Hosted evidence |
| --- | --- | --- | --- | --- |
| T1 | Privilege inventory: `has_function_privilege` for `anon`, `authenticated`, `service_role`, operator and test roles on every function and table in `public`, `private`, `lifecycle` | only gateway wrappers and read functions executable by `authenticated`; nothing mutating directly; `lifecycle` unreachable | yes (replayed chain) | repeat live (grants, exposed schemas A3) |
| T2 | Marker access by each non-operator role, including via PostgREST paths | no read, no write, no HTTP route | yes | yes (live PostgREST) |
| T3 | Register: missing, bad signature, expired, lower `seq`, ref absent, ref `production`, ref `never` (PHESMUN), malformed. **(a) Valid, unexpired, correctly signed `preproduction` copy (seq 7) used after seq 8 marks the ref `production`**, with and without a fresh attestation for seq 8 | refuses **before** connecting in both cases (the stale copy is refused because the attestation names seq 8 or is absent); assert no network call to the ref | yes (unit, with a fake authority) | the same against the real authority once decided (A12) |
| T4 | Old allow-list: environment lists the ref as staging while register says `production`. **(b) Fresh checkout with an empty local highest-seq record**, holding only the stale seq 7 copy | tool and build refuse; the result must not depend on local highest-seq state | yes (unit) | n/a |
| T5 | Contradictory refs, missing/unknown phase, stale register, unavailable verification. **(c) Authority unavailable**: network error, timeout, stale attestation, wrong nonce, digest mismatch, expired or revoked delegation | every hosted-target tool, build, health probe and server route fails closed with zero contact of the ref; local-only targets still run; no cached or override path | yes (unit) | yes (authority outage drill, A12) |
| T5b | Promotion barrier rehearsal: stop attestations, advance the clock past `V_att` | no tool or build treats the ref as `preproduction` after the barrier; entry-open time equals `T_last_attestation + V_att + margin` | yes (clock-controlled unit test) | yes (once, synthetic) |
| T6 | Wrapper: valid proof accepted; tampered argument, wrong function, wrong conf, wrong actor, wrong session, expired, future `iat`, wrong `aud`, wrong `epoch`, bad MAC, unknown `kid`, revoked key all refused | identical results to today for valid input; refusal otherwise; existing function sees the user as `auth.uid()` | yes | spot-check live (A4) |
| T7 | Phase/key-class matrix: `test` key in `synthetic_locked` and `production` refused; `evidence` key in `production` refused; `production` key in `synthetic_locked` refused | refused | yes | yes (**Preview-minted proof** from a protected Preview built with the `test` key) |
| T8 | Revocation across the T1 inventory: revoked grant, expired grant, wrong committee, deleted user, `iat` below floor | denied on RPC, read and write for each path | yes | yes with real tokens (A2, A9) |
| T9 | Direct RPC from a Preview or test client holding the publishable key and a **valid, correctly scoped** production-classified synthetic session | `42501`/denied; no row changes; receipt table unchanged | grants proved locally | yes, live |
| T10 | **Old cached bundle**: a pre-change bundle with real queued synthetic actions, loaded after direct execute is revoked | writes refused; outbox retained (`conflict`), nothing lost or doubled; reconciled by export before cutover | simulated client test | yes (real browser and service worker) |
| T11 | **Pre-issued session/token**: sessions and access tokens obtained before the transition | refused after the floor is raised and refresh revoked; or the wait-out is applied | claims-based test | yes (A1, A2) |
| T12 | **Spoofed headers**: `Origin`, `Referer`, `x-vercel-env`, `x-forwarded-*`, `Host`, a fake phase header, `Sec-Fetch-Site: same-origin`, to the gateway and to PostgREST | no effect on the decision (still refused without proof; still subject to grants) | unit on the route | yes |
| T13 | CSRF: cookie-only request, cross-site form post, simple-request attempt, missing custom header | rejected; no write | route unit test | yes (browser) |
| T14 | Idempotency through the gateway: repeat the same mutation UUID with a fresh proof; concurrent duplicates; ambiguous timeout then retry | one effect, same stored result | yes (extend `stale-conflicts`, `archive-concurrency` style tests) | yes (small) |
| T15 | `PT409`/`40001` pass-through and classification; denial codes not mapped to retryable or to `ConflictError` wrongly | existing client tests plus new cases | yes | spot-check |
| T16 | Transitions: illegal paths (`production` to anything, skipped phase, stale epoch, non-operator caller, update/delete on the log, direct `update` of the marker) | all refused; log append-only | yes | yes (as operator, `synthetic_locked` only) |
| T17 | Promotion race: in-flight writes at the instant of transition | each write either completes under the old epoch or is refused with the new one; no write after promotion carries a stale proof | yes (concurrent sessions) | not run on real data (writes are paused by procedure) |
| T18 | Tamper detection: marker changed out of band; register digest mismatch | gateway refuses writes and reports | yes (simulated) | yes, once, in `synthetic_locked` |
| T19 | Health on a refused target | zero network calls, status `down` | yes (existing style) | yes |
| T20 | Capacity through the gateway at Small (110 devices, 19 committees), including cost of the wrapper and floor checks | within the acceptance used for checklist 1.8 | no | yes (needs owner approval and spending; **not authorised here**) |
| T21 | Direct `service_role` execution of `submit_resolution`/`submit_amendment` with the pre-lock secret key, and `test`-class proof in `synthetic_locked` | refused (permission denied or lock); after promotion a human only confirms the old key is refused, non-destructively | yes | yes (agent-runnable, before promotion) |
| T25 | **Positive control, public submissions:** a valid active submission link and valid delegate, through the route for the phase (`test` key in `preproduction`, `evidence` key in `synthetic_locked`): create, exact repeat (`replayed`), same UUID with different details (`idempotency_conflict`), duplicate, rate limit at 20 per 10 minutes, revoked link, archived committee. **Negative:** wrong key class, no proof, one bound argument altered (each of the nine) | positives behave exactly as before the change; negatives refused with no row created | yes (extend `submissions-db`) | yes, **before promotion**, synthetic links only |
| T26 | **Positive control, amendment links:** valid amendment link and open resolution: create, replay, duplicate, `invalid_link`, `not_open`; negatives as T25 (each of the seven arguments) | as before the change; negatives refused | yes (extend `amendment-public` and the staff batch DB tests) | yes, before promotion |
| T27 | **Positive control, access codes:** anonymous session plus a valid code redeems and the resulting grant works through the gateway; the 8-failure rate limit still applies; an Executive rotates then revokes (with and without devices) through the gateway. **Negatives:** direct `redeem`/`rotate`/`revoke` RPC from a Preview or test client with a valid session; replay of a rotate or revoke proof (`jti`); `rotate` by a non-Executive; altered argument; `test`-class proof in `synthetic_locked` | positives unchanged; negatives refused, no grant created or changed, `proof_uses` records one use only | yes | yes, before promotion |
| T28 | **Argument-binding coverage:** generated from the T1 `pg_proc` inventory, one test per gated function altering each argument in turn after the proof is minted | every argument change refused; the suite fails if a gated function has an unbound argument | yes | spot-check |
| T23 | Runtime-policy matrix (8.1): every row, including a PROD build with policy `evidence`, an APPR deployment against a `production` register, a Preview with a copied `test` key in each phase, and marker/register disagreement | each row gives exactly the stated result; no row other than 1, 5 and 7 allows a write | yes (unit and wrapper tests) | rows 5 to 9 and 11 to 13 live in `preproduction` and `synthetic_locked`; rows 1 to 4 on the built Production configuration without writing |
| T24 | Older long-lived token after the Auth lifetime setting was reduced (7.3) | the entry bound uses the older token's later expiry; entry stays closed if the bound is unknown | claims-based simulation | yes (A11) |
| T22 | Production-classified positive control: legitimate staff write through the `evidence` gateway | accepted | yes | yes |

**Evidence recording.** Dated results in `docs/VERIFICATION.md` (checklist 1.4.6), each naming the commit, the phase, the epoch and whether it ran locally or hosted. **Local results are never presented as hosted evidence.**

**What local PG17 cannot show (hosted evidence is mandatory):** real Auth token and session behaviour (A1, A2, A5), PostgREST exposed-schema and pre-request configuration (A3, A8), Vault and `pgcrypto` availability (A3, A10), Realtime behaviour after revocation (A9), Vercel environment scoping and retirement of old deployments and aliases, real cached bundles and service workers, hosted grants and advisors, and capacity.

## 12. Open decisions for the owner

Each option has a recommendation. These are recommendations to review, **not decisions**.

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Implement the gates before 5 to 7 November, or accept a scope change | (a) implement all gates; (b) implement register, marker, token floor and fail-closed builds/tools now, gateway later, with a recorded scope change and compensating controls (no hosted credentials in any non-Production place, all old deployments retired, wait-out applied); (c) accept none and keep current controls | (a) if the owner can fund the schedule risk; otherwise (b). A gate is never silently dropped (checklist). No effort estimate has been made here; the window is about two weeks from 21 October. |
| D2 | Form of the register | (a) owner-signed file, committed and also published; (b) reviewed committed JSON only; (c) Vercel Edge Config or similar | (a). (b) is an agent-editable file, so it does not meet "not supplied by an agent". |
| D3 | Lifecycle phases | (a) three phases with `synthetic_locked`; (b) two phases, promote once and run evidence after; (c) rehearse production classification only locally | (a). It is the only way to obtain hosted evidence on production-classified synthetic state before real data, with a human-only demotion that exists solely before promotion. |
| D4 | Gateway mechanism | G1 proof plus user JWT via PostgREST; G2 service-key gateway that asserts the actor; G3 Supabase Edge Function as the gateway; G4 direct Postgres connection with a dedicated role | G1. G2 concentrates privilege and replaces actor checks with an asserted identity, which the lifecycle forbids; G3 and G4 change the architecture more and still need a proof the database can verify. |
| D5 | Proof algorithm | (a) HMAC-SHA256 in the database; (b) asymmetric signature verified in the database | (a), using what Postgres provides; (b) only if a verification extension is proved available (A10), because it keeps signing material out of the database. |
| D6 | Key storage in the database | (a) Supabase Vault; (b) a table with no grants | (a) if A10 holds, else (b). |
| D7 | Revocation enforcement point | (a) wrapper and `has_access` only; (b) add a PostgREST pre-request function; (c) add a per-session `session_id` check; (d) wait-out only | (a) first, (b) and (c) only if hosted proof and measured cost allow. Wait-out is always the fallback (7.3). |
| D8 | Reads | (a) leave direct, record the residual; (b) put snapshots behind a gateway too | (a). Realtime needs direct auth; (b) is a much larger change and a capacity risk. |
| D9 | Bind writes to sessions issued only by the Production app | (a) not now; (b) record Production-issued sessions at sign-in and require them | (a). Larger change; the proof plus grants plus no Preview credentials covers the lifecycle's wording. |
| D10 | Submission and amendment routes (6.3.2) | (a) server-principal proof wrappers and revoke direct `service_role` execute; (b) rely on key rotation and a Production-only secret; (c) put the user-principal profile on them | (a). (b) leaves a long-lived server key able to write after the lock; (c) cannot work because delegates have no user session. |
| D17 | Access-code RPCs (6.3.1) | (a) gate `redeem`, `rotate`, `revoke` through the gateway with single-use proofs for `rotate`/`revoke`; (b) gate only `rotate`/`revoke`, leave `redeem` direct; (c) leave all direct | (a). `redeem` creates authority, so leaving it direct lets a Preview with a leaked valid code create a grant. The cost is one more server hop on a low-volume path and keeping the raw code out of gateway logs. |
| D11 | Custody of the operator login and the signing key | owner only; owner plus a named witness; two-person rule | Owner holds both; John Paul Ribeiru witnesses promotion; recorded in the cutover evidence. Names and custody are the owner's to set. |
| D12 | Gateway capacity and cost | measure first at Small; or pre-approve a spending ceiling | Measure first (T20). This document approves no spending. |
| D13 | Incident break-glass for writes | (a) human-only direct SQL as the operator, logged; (b) none | (a), added to [EMERGENCY_RECOVERY.md](EMERGENCY_RECOVERY.md); never a client flag or header. |
| D14 | Ordering of cleanup versus evidence | clean up while `synthetic_locked` (section 10 step 6); or clean up while `preproduction` and enter `synthetic_locked` only for evidence | The first; it avoids a second demotion. |
| D16 | Freshness authority (4.1) | (a) delegated-key head attestation service plus the promotion barrier; (b) barrier only, with preproduction registers re-signed offline at short intervals and no attestation service; (c) rely on a third-party host (repository, Vercel) as the authority | (a). (b) forces frequent offline signing and still leaves a window up to the register life; (c) makes a vendor account the authority. Hosting and who operates the attestation key are the owner's to choose. |
| D15 | Runtime policies for gateway rehearsal (8.1) | (a) separately approved `preproduction` and `evidence` policies and key classes as in 8.1; (b) rehearse the gateway only locally and in Production at cutover; (c) allow the gateway in any non-Production deployment with a `test` key | (a). (b) leaves capacity and positive controls unproved on the hosted project; (c) weakens Preview denial. Each approved APPR deployment is an owner approval, recorded. |

**Assumptions to prove (hosted, not established):**

| # | Assumption |
| --- | --- |
| A1 | Hosted `jwt_expiry` value and that an issued access token stays valid until expiry after session revocation. |
| A2 | Whether `getUser`/`getClaims` and PostgREST reject an access token whose session has been revoked or deleted. |
| A3 | The `lifecycle` schema is not exposed by PostgREST and test roles have no route to it; the hosted exposed-schema setting. |
| A4 | A `SECURITY DEFINER` wrapper leaves `auth.uid()` and the JWT claims visible to the existing function (local proof first). |
| A5 | A database function may read Auth's session store, at acceptable cost. |
| A6 | The JWT `iss` carries the project ref and can be compared with the marker's `project_ref`. |
| A7 | The event trigger for DDL logging can be created and kept on the hosted project. |
| A8 | A PostgREST pre-request function can be configured on the hosted project and its per-request cost is acceptable. |
| A9 | Realtime stops delivering to a revoked or below-floor token (or the wait-out covers it). |
| A13 | Hosted `service_role` execute grants on `public` functions can be revoked and re-granted to wrappers only, and Supabase default privileges do not re-grant execute on new functions; grants are verified live (T1). |
| A12 | The attestation service can be hosted somewhere owner-controlled and reachable by tools and builds before Production exists, with acceptable availability, and the delegation scheme works as described. |
| A10 | `pgcrypto` HMAC and Vault are available on the hosted project (or an asymmetric verification extension for D5). |
| A11 | The longest lifetime of any token already issued can be established from Auth logs/sessions or the dashboard history of `jwt_expiry`. |

## 13. What is NOT decided

- Whether to implement any of this, in what order, and by when (D1), and who does the work.
- The exact names, columns, migration numbers and file layout above (illustrative).
- Register hosting location, expiry value, signing-key custody and rotation (D2, D11).
- Whether `synthetic_locked` exists (D3), key classes and counts, key rotation schedule.
- The proof lifetime (60 seconds proposed), clock-skew tolerance and the token-floor policy for incidents.
- The revocation enforcement point beyond the grant check (D7), the wait-out margin, the hosted `jwt_expiry` and the historical maximum lifetime `L_max` (7.3).
- Whether the access-code RPCs and public submissions go through the gateway at all (D10, D17), and the design of the `jti` single-use table.
- The freshness authority, `V_att`, delegation lifetime and barrier margin (D16, 4.1).
- Which deployments are approved as APPR, and the `preproduction`/`evidence` runtime policies (D15).
- Whether reads are gated (D8), whether Production-issued sessions are required (D9), and the break-glass procedure (D13).
- Gateway capacity, Vercel and Supabase cost, and whether Small compute is enough with the gateway (D12, T20).
- Any change to RLS, committee scoping, outbox, mutation UUID or idempotency semantics: **none is proposed**.
- Updates to `AGENTS.md`, `README.md`, `.env.example`, `DEPLOYMENT.md` and the checklist rows (these need their own reviewed change; checklist B11).
- Migrations, code, Supabase or Vercel changes, tags and version bumps: **not authorised by this document.**

## 14. Traceability to the lifecycle's "Target safeguards"

| Lifecycle clause | Section |
| --- | --- |
| 1 Register the ref explicitly; PHESMUN denied; exact match, no override | 4 (existing guard rules retained) |
| 2 Owner-controlled register plus server-enforced marker inaccessible to test roles, via reviewed migration | 4, 5 |
| 3 One nonproduction role until promotion; deny-list without database access; database lock rejects stale credentials | 4, 5.3 |
| 4 Tools fail closed on production, unknown phase, contradictory refs, stale lifecycle, unavailable verification | 4.4, 8 |
| 5 Preview builds and server routes fail closed at build and runtime; health must not contact the database on a refused target | 8 |
| 6 Server-side write boundary; Origin/CORS/public key/client flag are not proof; production-only gateway; actor authentication; CSRF; operation-bound proof; Preview proof refused; no service key in the browser | 6 |
| Cutover steps 3 and 4 (revocation, wait-out) | 7 |
| Evidence: lock and deny-list proof; Preview/server/direct-RPC and gateway proof on production-classified synthetic state; old bundles and pre-issued sessions | 11 |

Related: [V1_RELEASE_CHECKLIST.md](V1_RELEASE_CHECKLIST.md) rows 1.4.1 to 1.4.7, [DEPLOYMENT.md](DEPLOYMENT.md), [SUPABASE_PROJECT_SETUP.md](SUPABASE_PROJECT_SETUP.md), [STAGING_REHEARSAL.md](STAGING_REHEARSAL.md), [PT409_FIX_REPORT.md](PT409_FIX_REPORT.md), [`lib/platform/target-guard.ts`](../lib/platform/target-guard.ts), [`lib/supabase/repository.ts`](../lib/supabase/repository.ts), [`lib/sync/repository.ts`](../lib/sync/repository.ts).
