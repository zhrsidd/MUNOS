// Synthetic-conference cleanup engine: validation, script assembly and result parsing. Pure apart from reading the SQL files and
// spawning psql in PsqlRunner. It has no knowledge of any hosted project; the wrapper (scripts/cleanup-synthetic.mts) decides the
// target through lib/platform/target-guard.ts BEFORE a runner exists. Nothing here prints a secret.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TOKEN = /^[0-9a-f]{64}$/;
export const LABEL = /^[a-z0-9][a-z0-9_.-]{0,62}$/;
export const MARKER = "MUNOS_CLEANUP_JSON ";
export type Mode = "dry-run" | "execute";
export type Check<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/** Explicit, canonical, unique conference ids. Upper-case input is accepted and lower-cased; anything else is refused. */
export function parseConferenceIds(values: string[]): Check<{ ids: string[] }> {
  const ids: string[] = [];
  for (const raw of values.flatMap((v) => v.split(","))) {
    const id = raw.trim().toLowerCase();
    if (!id) continue;
    if (!UUID.test(id)) return { ok: false, reason: "a conference id is not a UUID" };
    if (ids.includes(id)) return { ok: false, reason: `conference id ${id} is listed twice` };
    ids.push(id);
  }
  if (!ids.length) return { ok: false, reason: "no conference ids were named; pass --conference <uuid> (this tool never selects conferences by pattern)" };
  return { ok: true, ids: ids.sort() };
}

/** Protected conferences: NEXT_PUBLIC_CONFERENCE_ID (required, fail closed) plus PROTECTED_CONFERENCE_IDS. Refuses any overlap with `ids`. */
export function checkProtected(ids: string[], env: Record<string, string | undefined>): Check<{ protectedIds: string[] }> {
  const configured = env.NEXT_PUBLIC_CONFERENCE_ID?.trim().toLowerCase() ?? "";
  if (!UUID.test(configured)) return { ok: false, reason: "NEXT_PUBLIC_CONFERENCE_ID is missing or not a UUID, so the ids cannot be checked against the protected conference. Set it in .env.local (fail closed)" };
  const extra = (env.PROTECTED_CONFERENCE_IDS ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (extra.some((v) => !UUID.test(v))) return { ok: false, reason: "PROTECTED_CONFERENCE_IDS contains a value that is not a UUID" };
  const protectedIds = [...new Set([configured, ...extra])];
  const hit = ids.find((id) => protectedIds.includes(id));
  if (hit) return { ok: false, reason: `conference ${hit} is protected (NEXT_PUBLIC_CONFERENCE_ID or PROTECTED_CONFERENCE_IDS)` };
  return { ok: true, protectedIds };
}

/** Project ref named by a Postgres URL: db.<ref>.supabase.co, or user postgres.<ref> on a *.pooler.supabase.com host. Else null. */
export function databaseUrlRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return null;
    const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname)?.[1];
    if (direct) return direct;
    if (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)) return /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username))?.[1] ?? null;
    return null;
  } catch { return null; }
}

/** A throwaway local database for tests only: loopback host and a database named munos_test_* or munos_local_*. A tunnel to a hosted `postgres` database does not match. */
export function checkLocalDatabaseUrl(url: string | undefined): Check {
  if (!url) return { ok: false, reason: "no local database URL" };
  try {
    const u = new URL(url);
    if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") return { ok: false, reason: "the local database URL is not a postgres URL" };
    if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return { ok: false, reason: "a local database must be on loopback" };
    if (!/^\/munos_(test|local)_[a-z0-9_]+$/.test(u.pathname)) return { ok: false, reason: "a local database must be named munos_test_* or munos_local_* (a tunnelled hosted database is not accepted)" };
    return { ok: true };
  } catch { return { ok: false, reason: "the local database URL is not a URL" }; }
}

export interface RunParams { mode: Mode; label: string; ids: string[]; protectedIds: string[]; token?: string }
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** The complete script for one run. Every interpolated value was validated against a strict pattern first. */
export async function buildScript(sqlDir: string, p: RunParams): Promise<string> {
  if (!LABEL.test(p.label)) throw Error("invalid label");
  if (!p.ids.length || !p.ids.every((v) => UUID.test(v))) throw Error("invalid ids");
  if (!p.protectedIds.length || !p.protectedIds.every((v) => UUID.test(v))) throw Error("invalid protected ids");
  if (p.mode === "execute" && !(p.token && TOKEN.test(p.token))) throw Error("execute needs a 64-hex confirmation token");
  const settings: Record<string, string> = { mode: p.mode, label: p.label, ids: p.ids.join(","), protected: p.protectedIds.join(",") };
  if (p.token) settings.token = p.token;
  return assemble(sqlDir, settings, p.mode);
}

/** The transaction around the SQL parts, from raw settings. Tests use this to prove the SQL refuses on its own, without this file's validation. */
export async function assemble(sqlDir: string, settings: Record<string, string>, mode: Mode): Promise<string> {
  const sql = async (name: string) => readFile(join(sqlDir, name), "utf8");
  const set = `select ${Object.entries(settings).map(([k, v]) => `set_config('munos_cleanup.${k}', ${q(v)}, true)`).join(", ")};`;
  // A dry run turns itself read only in 00-prepare.sql, after its temp tables exist, and always ends in rollback.
  const parts = mode === "dry-run" ? [await sql("10-dry-run-report.sql"), "rollback;"] : [await sql("20-execute.sql"), "commit;"];
  return ["begin;", "set local lock_timeout = '5s';", set, await sql("00-prepare.sql"), ...parts].join("\n");
}

export interface TableRow { seq: number; table: string; kind: string; rows?: number; expected?: number; affected?: number; exact?: boolean; fingerprint?: string }
export interface Report {
  kind: "dry-run" | "execute"; status: "ready" | "nothing_to_delete" | "deleted"; label: string; token: string; executed_at?: string;
  conferences: { id: string; name: string; venue: string }[]; absent_ids: string[]; tables: TableRow[];
  total_rows_deleted_if_executed?: number; total_rows_deleted?: number;
  storage: { document_version_keys: string[]; bucket_objects: { bucket: string; key: string }[]; note?: string };
  auth_user_candidates: string[]; auth_users_kept_because_referenced_elsewhere?: number;
}

/** The single marked JSON line a run prints. */
export function parseReport(lines: string[]): Report {
  const found = lines.filter((l) => l.startsWith(MARKER));
  if (found.length !== 1) throw Error(`expected exactly one report line, got ${found.length}`);
  return JSON.parse(found[0].slice(MARKER.length)) as Report;
}

export interface Runner { run(script: string): Promise<string[]> }

/** Runs a script in one psql session (one connection, so the transaction and temp tables hold). The password travels in the environment only. */
export class PsqlRunner implements Runner {
  constructor(private readonly url: string, private readonly psql = process.env.PSQL_BIN ?? "psql") {}
  run(script: string): Promise<string[]> {
    const u = new URL(this.url);
    const child = spawn(this.psql, ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
      env: { ...process.env, PGHOST: u.hostname.replace(/^\[|\]$/g, ""), PGPORT: u.port || "5432", PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password), PGDATABASE: decodeURIComponent(u.pathname.slice(1)) || "postgres", PGSSLMODE: u.searchParams.get("sslmode") ?? (["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ? "prefer" : "require"), PGAPPNAME: "munos-synthetic-cleanup" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    return new Promise((resolve, reject) => {
      child.on("error", (e) => reject(e));
      child.on("close", (code) => code === 0 ? resolve(out.split("\n").filter(Boolean)) : reject(new CleanupError(describeFailure(err), code ?? 1)));
      child.stdin.end(script);
    });
  }
}

export class CleanupError extends Error { constructor(message: string, readonly code = 1) { super(message); } }

/** Error text from psql, reduced to the lines that explain the refusal; the connection string and any password never appear in psql output. */
export function describeFailure(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter((l) => /^(psql:.*ERROR:|ERROR:)/.test(l) || /REFUSED|COUNT MISMATCH/.test(l));
  const text = (lines.length ? lines.join(" ") : stderr.trim().split("\n").slice(-2).join(" ")).replace(/^psql:[^ ]*\s*/, "");
  return text.slice(0, 600) || "psql failed";
}

/** Structural type of a PGlite handle (kept structural so this file does not import the test database). */
export interface PgliteLike { exec(sql: string): Promise<{ rows: Record<string, unknown>[] }[]> }
/** Run in an embedded PGlite. A failed script is rolled back explicitly: PGlite keeps the session, and an aborted transaction would linger. */
export function pgliteRunner(db: PgliteLike): Runner {
  return {
    async run(script) {
      try {
        const results = await db.exec(script);
        return results.flatMap((r) => r.rows.map((row) => String(Object.values(row)[0] ?? "")));
      } catch (error) {
        await db.exec("rollback;").catch(() => undefined);
        throw new CleanupError(describeFailure((error as Error).message));
      }
    },
  };
}
