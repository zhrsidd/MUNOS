# HD10 authorization matrix recovery

Recovered from `claude/write-rpc-authz-tests` at `1195e3ef09b46c52fef54f2df810edb6f2397b84` after its author reached the account limit.

The saved branch had no native entrypoint despite referencing one, and its PostgreSQL adapter forwarded unterminated SQL fragments. This change supplies the loopback-only PostgreSQL 17 entrypoint and terminates fragments before the psql marker. Each engine runs the same 3,736 authorization cells; no hosted target is involved.

## Owner-confirmed receipt acknowledgement contract

On 22 October 2026 the owner selected: **confirm previously saved actions** after access revocation. The exact same actor, conference, idempotency key and payload may acknowledge an existing receipt; it performs no new write and creates no authority. A fresh mutation remains denied with `42501`; changed identity or payload remains refused by idempotency binding. The matrix covers those bindings and five representative commands across all four implementations after revocation.

The former failing TODO required a contradictory policy (reject every old receipt), so it has been removed. Its characterization is now the explicit contract regression. No database function or access grant changed to implement this decision. Revocation still blocks fresh work immediately; acknowledgement of an earlier accepted action is not new access.

Run the PGlite and native entries together with `TEST_POSTGRES_URL` naming a disposable loopback PostgreSQL 17 server. Authorization roles are real database roles; each cell rolls back. Hosted session/token invalidation, PostgREST transport, browser/outbox reactions and combined release readiness require separate evidence.
