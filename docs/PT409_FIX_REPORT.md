# Non-retryable stale-conflict fix — 6 October 2026

Development only: `opmydpozhdgkpcnjwpqb`. This is a narrowly scoped conflict-code correction, not snapshot optimization or capacity certification.

| Requested check | Result |
| --- | --- |
| 1. Active routines using 40001 | `private.apply_mutation` (1 raise), `private.apply_operations_mutation` (1), `private.apply_procedure` (4). Inspected current `pg_get_functiondef`, not historical text. Public wrappers did not themselves contain 40001. |
| 2. Replacement | Six explicit application-conflict raises now use `RAISE SQLSTATE 'PT409' USING MESSAGE=...`. User-facing messages unchanged. Genuine engine serialization behavior untouched. |
| 3. Forward migration | `20261006135232_nonretryable_stale_conflicts.sql`. Created with the CLI, committed before applying, then filename aligned to the actual remote ledger version. |
| 4. Client | `SupabaseTransport.send()` recognizes PT409 as `ConflictError`; defensive legacy 40001 handling remains. No outbox, authorization, locking, revision or receipt changes. |
| 5. Real RPC result | Existing GA1-only Chair identity; attendance, queue order, speech/POI allowance, document and vote stale requests each repeated three times. All 15 timed responses were HTTP 409 / PT409 in 118–189 ms. Five additional real transport requests threw `ConflictError`. |
| 6. Retry-loop check | Postgres logs for 13:56:06–13:57:00 UTC contained exactly 20 PT409 entries for the 20 deliberate stale calls and zero 40001 entries. Each failed once; no loop observed in this verification window. |
| 7. pg_stat_activity | After verification: three authenticator connections, all idle/ClientRead; zero active or stuck authenticator queries. No sessions terminated. |
| 8. Ledger | Original 11 entries preserved; exactly one new migration, 12 total. No migration replay. Post-apply definitions matched the captured pre-apply definitions with only the six expected raise-expression substitutions; zero active functions in public/private contained 40001. |
| 9. Typecheck | Passed. |
| 10. Lint | Passed. |
| 11. Tests | 78 passed. New coverage checks seven PostgreSQL stale paths, zero rejected-write effects/receipts/notifications, PT409 client classification, bounded sends, retained conflicting and subsequent intent through repeated flush and restart, and 40001 compatibility. Existing offline/lost-response/idempotency tests pass. |
| 12. Build | Production build passed locally. This is a build check, not a production deployment. |
| 13. Corrected 25-staff result | **Not run. Blocked on Claude’s corrected harness and existing role-scoped session fixtures.** Both available local checkouts contain only the older all-roles load script. Requested the missing file location; did not substitute that test, create Auth users, alter grants, or perform NAT probes. Errors/conflicts/duplicates/lost writes, read/write p50/p95, snapshot calls and reads/write are therefore **not measured** for 25 staff. |
| 14. Backends after 25 staff | Not applicable: no 25-staff run occurred. The smaller RPC verification left no active/stuck authenticator backend. |
| 15. Proceed to 50? | **No.** First run the corrected 25-staff harness with its existing committee-scoped Chair, Approval, Admins and Executive identities, then inspect logs/activity and report its metrics. Do not start 50 staff yet. |

Remote evidence: [stale-conflict-remote-results.json](stale-conflict-remote-results.json). Regression tests: `tests/stale-conflicts.test.ts`. Single-identity RPC verifier: `scripts/verify-stale-conflicts.mts`; supply an ignored existing GA1-only Chair session via `STAFF_SESSION_FILE`. It refreshes an existing session and never signs up a user.

The earlier generic saved session lacked access. Its denied read made no mutation; it was not granted additional access. The successful verification used the existing GA1-only Chair browser identity. Ordinary attendance writes and exact duplicate replay remained unchanged; a temporary general-debate speech created for the speech-revision check was finished afterward.

Historical applied migration files still contain 40001 as an accurate record of past schema state. Do not edit them. The current database definitions are the authoritative verification target.

[Supabase’s documented failure mode and PT409 recommendation](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

PR #7 was found already merged into main at `89c9dfd9dbf5e80b5501c8ae994e952028e05a8d`; this fix is on `codex/nonretryable-stale-conflicts` based on that main. PR #6 stays draft/unmerged. No changes to snapshots, amendments, Drive, Vercel, RLS or unrelated code; no production deployment.
