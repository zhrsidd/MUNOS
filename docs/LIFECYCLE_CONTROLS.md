# Minimal lifecycle controls for this conference

This implements the remaining register/marker and test-purpose controls for the owner's approved direct RPC path. It does **not** implement a gateway, signed freshness, deployment-bound writes or protection against a database owner/superuser. Permitted production staff calls still work outside the website, as the owner accepted.

## Current authority

`config/project-lifecycle.json` is the committed, independently reviewed source record. This final source record classifies the DCMUN project `kllhswucdhqqywnzxado` as production; PHESMUN is always forbidden. The hosted database marker is a separate human-controlled transition: this source classification is not evidence that the database was promoted. Activation follows [the final source handover](cutover/2026-11-01/REGISTRY_RELEASE.md). `assertToolTarget` and nonproduction deployment checks require this record **and** the environment allow-list. Unknown or production refs cannot be authorized by a process override. `checkToolTarget` remains the lower-level environment-only parser and must not be used alone as a tool authorization.

Migration `20261026003647_lifecycle_controls.sql` adds the private singleton marker, revision and timestamp. Only the human database owner can change it. Production cannot be demoted, the ref cannot change and normal deletion/truncation refuse. A database owner or superuser can deliberately override triggers; all administrative/cloud/test credentials still need retirement.

The only new anonymous EXECUTE exception is `public.preproduction_status()`: fixed project ref, phase, revision and `canTest`, without conference/user/key/grant data. Test tools read it freshly, without caching or Auth enrollment, after all local target/fixture checks. Missing, invalid, contradictory, production or unavailable state refuses. This read is an unsigned preflight; it does not attest deployment origin or guarantee an old checkout is fresh.

## Database barrier

Existing staff credentials, grants, resolution links and amendment links are marked `test_only=true`. Preproduction/rehearsal accepts test access; production accepts non-test access. Redemption copies class exclusively from the locked credential, including conflict UPDATE. Access projections and direct grant RLS honor class, so stale test grants do not regain data merely because their revocation field was missed. The four server-key public link/submission RPCs independently honor link class.

Mutation handlers, access-code handlers and public submissions acquire a shared lifecycle transaction lock **before** their existing authority, mutation, committee and credential locks. The transition takes the exclusive lock. Native PostgreSQL tests exercise rotation, amendment-link and procedure races, plus an accepted write that drains before promotion. Exact accepted staff receipt retries keep their existing same-actor/conference/payload acknowledgement; no new effect is executed after authority is lost. Public submission receipt semantics are unchanged: a valid link is still required.

New code/link defaults derive their class from the server marker. Generated test-fixture SQL takes the same lock and checks preproduction **inside its transaction before inserting anything**; grants explicitly remain test-only. The production Executive bootstrap explicitly requires production and creates non-test authority. API roles cannot directly assign a class. Cleanup refuses outside preproduction/rehearsal and retains the singleton marker; tests independently fingerprint it with other preserved global state.

## Before hosted application

Replay every migration locally, run the full native PostgreSQL 17/PGlite tests, regenerate/check the permission inventory and independently review the exact committed source. Apply only while this single project is synthetic preproduction, never by rerunning this migration against an already-promoted project. The migration initializes a preproduction marker; it is not a phase detector for an arbitrary database.

Verify after application: exact migration source/ledger; anonymous metadata and all other anonymous denials; API-role marker/DML denial; unchanged service-role table restrictions; test staff and QR workflows. Record the evidence separately from local results. Do not mark the hosted controls or load readiness verified from green local tests.

## Human cutover order (prepare now; do not execute early)

1. Stop and drain all tests, enrollment/refresh loops, hosted scripts and app writes. Close connected Previews and retire their server keys/URLs according to the release checklist. A preflight cannot cancel an already-running process or Auth request.
2. In the controlled owner transaction, acquire the **exclusive** lifecycle lock (`pg_advisory_xact_lock(6210692840397143::bigint)`) before credential/grant retirement. Revoke all test grants, codes and QR links, and separately revoke Auth sessions/refresh capability. Record the last possible token issuance. Retire leaked/legacy API and server keys, Storage capabilities and cloud connectors separately.
3. Complete reviewed synthetic cleanup and the backup/restore evidence while the phase remains preproduction, then record the owner-approved token wait. The confirmed Auth setting is **3,600 seconds**; wait that long from the last possible test-token issuance, plus the recorded clock margin and any longer expiry of older tokens. If issuance resumes, restart the wait. None of this has happened merely because the code exists.
4. Prepare the source record change to production as its own final source revision, with independent review, local/CI verification and exact-SHA release approval before transition. It is a different SHA from the preproduction candidate; do not reuse that earlier approval. With writes still closed and the other readiness gates passed, the human owner activates that approved source record, removes all test allow-lists and updates the marker to production under the exclusive lock. The marker refuses promotion if any test grant, credential or QR link remains unrevoked. It does not itself prove cleanup, token expiry, spending approval or backup quality.
5. The human operator configures/releases the exact verified Production app and the compatible credential-rotated rollback deployment, then performs view-only verification and obtains release sign-off. Only after sign-off does the human bootstrap the first production Executive and open real-data entry (V1 release checklist Phase 4.1). Cloud agents have no hosted access after promotion. No automatic demotion or reopening is provided.

The load window remains **31 October**. No paid upgrade or full hosted workload is authorized earlier by this implementation. Full conference readiness, physical-device offline behavior, Google document access, actual load/Realtime fanout and hosted restoration evidence remain separate gates.

## Hosted preproduction checkpoint

The exact reviewed migration was applied on 26 October, with the ledger reconciled to 29 committed versions only after exact source equality. The marker remains preproduction, revision 1. Live phase/permission/three-role/public QR and 39-assertion offline results are recorded in [PRECUTOVER_VERIFICATION_2026-10-26.md](PRECUTOVER_VERIFICATION_2026-10-26.md). Production-state/race proofs remain local; no hosted promotion occurred. Cutover credential, key, Preview and connector retirement is still outstanding.
