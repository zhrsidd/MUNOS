# HD10 authorization matrix recovery

Recovered from `claude/write-rpc-authz-tests` at `1195e3ef09b46c52fef54f2df810edb6f2397b84` after its author reached the account limit.

The saved branch had no native entrypoint despite referencing one, and its PostgreSQL adapter forwarded unterminated SQL fragments. This change supplies the loopback-only PostgreSQL 17 entrypoint and terminates fragments before the psql marker. Each engine runs the same 3,736 authorization cells; no hosted target is involved.

## Unresolved contract finding F1

The suite deliberately retains its existing failing TODO. A caller whose grant is revoked receives success when replaying the exact idempotency key/payload of an action accepted before revocation. The stored receipt is returned before current grant validation. **No new write occurs**, and a fresh mutation is denied with `42501`. Five representative commands cover all four implementations on both engines.

This is an unresolved revocation/client-signalling contract, not a demonstrated new-write permission bypass. Changing receipt ordering can affect retries after the target is removed or moved, so the recovery does not rewrite shared mutation functions or silently select that behavior. F1 must be resolved explicitly before claiming HD10 is complete. Green test exit with one TODO is not full gate closure.

Run the PGlite and native entries together with `TEST_POSTGRES_URL` naming a disposable loopback PostgreSQL 17 server. Authorization roles are real database roles; each cell rolls back. Hosted session/token invalidation, PostgREST transport, browser/outbox reactions and combined release readiness require separate evidence.
