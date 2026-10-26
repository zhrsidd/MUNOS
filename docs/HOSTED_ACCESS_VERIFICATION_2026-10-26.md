# Hosted access and Realtime verification — 26 October 2026

Owner-authorized, bounded correctness verification on DCMUN Staging (`kllhswucdhqqywnzxado`, PostgreSQL 17.11), still in its synthetic-only preproduction phase. This was not a load run, production cutover or spending approval. [Machine-readable evidence](evidence/access-boundaries-2026-10-26.json).

## Preconditions and safety

Read-only preflight confirmed three labelled test conferences, synthetic delegate email addresses and staff, anonymous-only Auth users, the exact selected fixture and a 28-row migration ledger. The repository target guard accepted the one staging ref; a production classification or conflicting shell/file URL stops the probe before network access. The selected conference was `0331ceb6-3fa8-4731-92cb-2b4c0316d0cb`, DCMUN Development Test.

The one-off probe was independently reviewed before execution. It created dedicated anonymous Executive identities through the existing synthetic access code. Their public IDs were recorded before redemption, so a lost acknowledgement would not prevent exact grant retirement. JWTs remained in memory; credentials were neither printed nor committed. Sign-out used `scope: local` on each probe's own session. No shared code was rotated or revoked.

## Results

| Boundary | Observed result |
| --- | --- |
| Valid device | Executive snapshot, school-table read and normal app-transport save succeeded; both channels received the fresh baseline event. |
| Auth session signed out, grant still active | Captured, unexpired JWT still read the snapshot, saved a fresh test school and received Realtime. Refresh was refused. SQL independently confirmed that the Auth session was absent before grant revocation. Sign-out alone is therefore insufficient immediate revocation for this path. |
| Dedicated grant revoked | Snapshot returned `42501`; school-table read returned zero rows; fresh write returned `42501`. |
| Exact accepted retry after grant revocation | Acknowledged, with exactly one original school row and one receipt. |
| Changed payload under the accepted mutation ID | Refused with `22023`; no changed school row appeared. |
| Existing channel after grant revocation | The active control received all three fresh marker events; the revoked channel, still reporting `SUBSCRIBED`, received none. Observation included a further five-second quiet window. This is bounded evidence, not a universal delivery guarantee. |
| Retirement | Independent SQL confirmed all four new test grants from both attempts revoked and zero remaining Auth sessions for those devices. Labelled synthetic schools remain for later guarded cleanup. |

These tests cover one Executive identity and representative snapshot/table/mutation/Realtime paths. They do not close an every-role/every-RPC hosted authorization matrix. The full local matrix remains independently tested on PGlite and PostgreSQL 17.

## Realtime readiness finding and fix

The first attempt stopped at its baseline: both channels reported `SUBSCRIBED`, but neither received the initial marker within 12 seconds. Independent SQL proved that the school, receipt and notification each existed once. Realtime logs showed tenant initialization at 23:33:17.439 UTC, the notification at 23:33:17.508 UTC, and replication-stream startup at 23:33:17.674 UTC on 25 October (26 October Qatar time). A startup gap is plausible; this is not a lost save or a proven sole cause.

The pinned `@supabase/realtime-js` 2.117.2 source explicitly documents that default `SUBSCRIBED` may precede PostgreSQL change readiness. Its supported `config.postgres_changes_options.wait` option holds the acknowledgement until the table subscription is active. The instrumented rerun enabled that option, required a new baseline event on both channels, and passed all boundaries above. The probe's fixed-JWT channel also received a fresh control marker after Auth sign-out, eliminating channel deauthentication as an explanation for later silence.

The application transport now requests the same readiness option. It adds no write, snapshot or polling request and changes no schema, grants or mutation contract. A database subscription refusal reports disconnected and retains the existing recovery path. Two real-SDK protocol tests reproduce the former early-connected behavior and verify readiness, normal invalidation delivery and failure reporting; both fail against the former code and pass with the change. The existing 18 invalidation tests also pass.

## Still outstanding

- Production remains demo. The approved [direct RPC scope](RELEASE_SCOPE_2026-10-26.md) does not promote the database or close other lifecycle gates.
- The newly issued JWTs expired about an hour after issuance. The owner subsequently confirmed the dashboard setting is 3,600 seconds and accepted a cutover wait-out; see [the recorded decision](RELEASE_SCOPE_2026-10-26.md#token-wait-out-and-load-window--owner-confirmations). This observation alone was not a maximum-lifetime proof or a fresh authorization after expiry. The actual revocation/last-issuance time and expiry of any older, longer-lived tokens still need recording at cutover.
- Hosted expiry and the remaining roles/RPCs, legacy key invalidation, public QR HTTP, full browser offline/restart/two-device conflict rehearsal and the Small-compute capacity gate remain separate.
- No migrations, schema changes, synthetic-data deletion, compute upgrade, Production deployment, version or tag occurred in this run.

## Hosted numbering rollback verification

Ran only the already-reviewed Part 2 functional block from [NUMBERING_HOSTED_VERIFICATION.md](NUMBERING_HOSTED_VERIFICATION.md#41-part-2-append-after-the-migration-text) against the applied functions; no migration text was re-executed. The deliberate final exception returned `DRYRUN_OK`: owner-only helper, pinned search path, Chair drafts 01/02/03, exactly-once Chair replay, public SQL-boundary submission 04 and replay, legacy hex ignored, and Chair/public boundaries 100/101. This is SQL-boundary evidence, not public HTTP or hosted concurrency proof.

A separate query before and after proved identical table counts (3 conferences, 3 committees, 3 documents, 10 delegates, 93 anonymous Auth users, 83 grants, 176 receipts, 181 notifications), the 28-row ledger and all three function digests. The fixture, user, grants and test documents were rolled back. The original hosted documents and migration bodies were unchanged.

Function MD5s: private.apply_mutation `bb653a4a248a747f796c6537587997c2`; public.submit_resolution `7059bc67d9f89fd8aa26359ecbe6b963`; private.next_resolution_code `fdf59b4fe80821e91bd10d2fb4242c7c`.

## Local validation of the readiness change

Typecheck, lint and the standard production build pass. Full suite: **825 pass, zero fail/skip/TODO** on local disposable PostgreSQL 17 / UTF-8. The focused real-SDK protocol regressions both fail against the prior transport and pass with the change. An independent reviewer approved the transport diff, protocol tests and scope record; hosted results were separately inspected by the operator.
