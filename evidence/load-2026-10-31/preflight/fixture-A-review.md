# PF14 review of fixture A (local, no network; nothing applied to staging)
Conference `573cfbeb-d3ed-4cf5-b418-7d36326f69c8`, fixture.sql 1,168 lines, cleanup.sql 12 lines.
- One conference id: 1,150 references in fixture.sql; all 1,147 multi-row tuples carry it; none of the 5 protected ids appears in fixture.sql or cleanup.sql.
- Statements: begin; lifecycle lock + `lifecycle_allows(true)` guard; inserts into conferences, schools, committees, sessions, delegates, roll_call, roll_call_row, documents, document_versions, resolution_links, scoring_definitions, user_access; commit. No update, delete, DDL, grant or revoke.
- Counts: 19 committees, 19 sessions, 420 delegates, 19 roll calls (420 rows), 76 documents/versions/resolution links, 22 grants (19 chair, approval, logistics, admin), 3-hour expiry, test_only true. The 22 users equal the 22 pool users; no Auth rows, secrets, tokens or access codes (scan 0 hits).
- cleanup.sql: lifecycle guard, then only `revoked_at=now()` updates scoped to this conference on user_access, submission_links, amendment_links, private.access_credentials. Deletes nothing.
- Local replay on a fresh PGlite built from all 36 committed migrations: fixture applies; counts as above; 22 active grants -> 0 after cleanup; all 420 delegates remain.
