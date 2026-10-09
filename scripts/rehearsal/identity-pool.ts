// Planning for the rehearsal identity pool (scripts/rehearsal-identities.mts). Pure; no I/O.
// One anonymous session per Chair (one per simulated real committee) plus one each for Approval, Admins and Executive.
// Grants are NOT created here; scripts/rehearsal-fixture.mts grants them for one fresh conference.
import type { MultiCommitteeFile } from "./identities";
export const MAX_CHAIRS = 40;
/** New anonymous sign-ins per helper run: stays under Supabase's default 30 anonymous sign-ins per IP per hour. */
export const MAX_NEW_SIGN_INS_PER_RUN = 25;
export const DEFAULT_PACE_SECONDS = 20;
export interface PoolEntry { label: string; path: string }
export function checkPoolDir(dir: string) {
  const normalized = dir.replace(/\/+$/, "");
  if (!/^\.test-sessions(\/[A-Za-z0-9._-]+)*$/.test(normalized) || normalized.split("/").includes("..")) throw Error(`Identity files must stay under the git-ignored .test-sessions/ directory (got ${dir}).`);
  return normalized;
}
export function planPool(chairs: number, dir: string): { entries: PoolEntry[]; template: MultiCommitteeFile } {
  if (!Number.isInteger(chairs) || chairs < 1 || chairs > MAX_CHAIRS) throw Error(`--chairs must be a whole number 1–${MAX_CHAIRS}.`);
  const base = checkPoolDir(dir);
  const chairEntries = Array.from({ length: chairs }, (_, i) => ({ label: `chair ${i + 1}`, path: `${base}/chair-${String(i + 1).padStart(2, "0")}.json` }));
  const support = (["approval", "admins", "executive"] as const).map((role) => ({ label: role, path: `${base}/${role}.json` }));
  return {
    entries: [...chairEntries, ...support],
    template: { mode: "multi-committee", chairs: chairEntries.map((e) => ({ session: e.path })), approval: { session: support[0].path }, admins: { session: support[1].path }, executive: { session: support[2].path } },
  };
}
