# PF18 (local part) review of fixture B; nothing applied to staging
Conference `1e6bb11f-95c2-4acc-9849-2047818cbdd4`, fixture.sql 1,168 lines (sha256 20f41dadbe5e1df61a220a24888647e3e493c00740642632d93a31e78b334e54), cleanup.sql 12 lines. Same generator and shape as fixture A.
- One conference id; all 1,147 multi-row tuples carry it; none of the 5 protected ids and not fixture A's id appears in either file.
- Only inserts between begin/commit after the lifecycle lock and preproduction guard. No update, delete, DDL, grant or revoke. Secret scan: 0 hits.
- 19 committees, 420 delegates, 22 grants (19 chair, approval, logistics, admin) with a 4-hour expiry; all 22 users are the pool users. Roll calls are backdated 1 hour (as in A).
- cleanup.sql only sets revoked_at for this conference on user_access, submission_links, amendment_links, private.access_credentials; deletes nothing.
- Local replay of A then B on a fresh database built from all committed migrations: both apply with no collision; B cleanup leaves B at 0 active grants, A still 22, B delegates 420.
