// Safety guard for the rehearsal harness. There is deliberately NO override: production is never a target.
//  1. URL shape: localhost, or a Vercel *deployment/branch* URL (…-git-…vercel.app or …-<hash>-…vercel.app).
//     Custom domains and bare project aliases (likely production) are refused.
//  2. The target's own /api/health must report a non-production environment.
// The Supabase side is separately locked to the development project by scripts/remote-context.mts.
export interface GuardResult { ok: boolean; reason: string }
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
export function checkAppUrl(raw: string | undefined): GuardResult {
  if (!raw) return { ok: false, reason: "Pass --app <url> explicitly (a Vercel Preview URL or http://localhost:<port>). There is no default target." };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, reason: `Not a URL: ${raw}` }; }
  if (url.username || url.password) return { ok: false, reason: "Credentials in the URL are not allowed." };
  if (LOCAL.has(url.hostname)) return url.protocol === "http:" || url.protocol === "https:" ? { ok: true, reason: "local development server" } : { ok: false, reason: "Use http(s)." };
  if (url.protocol !== "https:") return { ok: false, reason: "Remote targets must use https." };
  const host = url.hostname.toLowerCase();
  if (!host.endsWith(".vercel.app")) return { ok: false, reason: `Refusing ${host}: only Vercel Preview URLs (*.vercel.app) or localhost are allowed. Custom domains may be production.` };
  const label = host.slice(0, -".vercel.app".length);
  const branch = label.includes("-git-");
  const deployment = label.split("-").some((part) => /^[a-z0-9]{9}$/.test(part) && /\d/.test(part) && /[a-z]/.test(part));
  if (!branch && !deployment) return { ok: false, reason: `Refusing ${host}: looks like a project/production alias. Use the Preview deployment URL (…-<hash>-…vercel.app) or branch URL (…-git-<branch>-…vercel.app).` };
  return { ok: true, reason: branch ? "Vercel branch Preview URL" : "Vercel deployment URL" };
}
/** Second check against the deployment's own build identity (from GET /api/health). */
export function checkHealthEnvironment(report: unknown): GuardResult {
  const environment = (report as { app?: { environment?: unknown } })?.app?.environment;
  if (typeof environment !== "string") return { ok: false, reason: "Target did not return a Conference OS /api/health report." };
  if (environment === "production") return { ok: false, reason: "Target reports environment=production. Rehearsals never run against production." };
  if (!["preview", "development", "local-build"].includes(environment)) return { ok: false, reason: `Unknown environment "${environment}".` };
  return { ok: true, reason: `environment=${environment}` };
}
export const MAX_USERS = 200;
export function checkUsers(n: number): GuardResult {
  if (!Number.isInteger(n) || n < 1) return { ok: false, reason: "Users must be a positive whole number." };
  if (n > MAX_USERS) return { ok: false, reason: `At most ${MAX_USERS} simulated users.` };
  return { ok: true, reason: `${n} users` };
}
