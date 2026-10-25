import {freshDatabase} from './helpers/database';
import {pgliteEngine} from './helpers/authz-engine';
import {registerAuthzSuite} from './helpers/authz-suite';

// HD10: per-function authorisation matrix for the direct-RPC release path, on PGlite (always runs).
// tests/write-rpc-authz-pg17.test.ts runs the same suite on real PostgreSQL 17 when TEST_POSTGRES_URL is set.
registerAuthzSuite('PGlite', async () => {
 const t = await freshDatabase();
 return {engine: pgliteEngine(t.db), ids: t.ids, close: () => t.db.close()};
});
