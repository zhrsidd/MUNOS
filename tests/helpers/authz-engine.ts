import type {PGlite} from '@electric-sql/pglite';
import type {PostgresConnection} from './postgres';

/**
 * One SQL engine seen through a single call: run a script, get the value of its last SELECT (first column) as text.
 * PGlite and a real PostgreSQL 17 connection (psql on stdin) expose the same surface, so one table-driven matrix
 * runs unchanged against both.
 */
export interface Engine {
 readonly name: string;
 run(sql: string): Promise<string>;
}

export function pgliteEngine(db: PGlite): Engine {
 return {
  name: 'PGlite',
  async run(sql) {
   try {
    const results = await db.exec(sql);
    const last = [...results].reverse().find(r => r.fields.length > 0);
    if (!last || !last.rows.length) return '';
    const value = Object.values(last.rows[0] as Record<string, unknown>)[0];
    return value === null || value === undefined ? '' : String(value);
   } catch (error) {
    // A failed setup statement leaves the transaction open; never poison the shared database.
    await db.exec('rollback').catch(() => undefined);
    throw error;
   }
  },
 };
}

export function postgresEngine(connection: PostgresConnection): Engine {
 return {
  name: 'PostgreSQL 17',
  run: sql => connection.query(sql.trimEnd().endsWith(';') ? sql : `${sql};`),
 };
}
