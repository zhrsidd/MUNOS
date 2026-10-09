// Role-scoped rehearsal identities: pre-authorized sessions, each holding ONLY its role's grant.
// Sessions near expiry are refreshed (same Auth session, new access token) before a run. Never signs anyone in.
//
// Two identity-file shapes:
//  * REALISTIC MULTI-COMMITTEE (readiness): one Chair identity PER real committee.
//      { "mode": "multi-committee", "chairs": [{ "session": "<file>", "committee": "<uuid>" }, …],
//        "approval": { "session": "<file>" }, "admins": { "session": "<file>" }, "executive": { "session": "<file>" } }
//    A template written by scripts/rehearsal-identities.mts has chairs without `committee`; scripts/rehearsal-fixture.mts
//    assigns chairs[k] → committee k and writes the run file.
//  * LEGACY SINGLE-COMMITTEE (historical/worst-case only): one Chair identity scoped to ONE committee; simulated
//    committees were extra "floor" sessions inside it, so every Chair write serialized on one committees row.
//      { "chair": { "session": "<file>", "committee": "<uuid>", "sessions": ["<uuid>", …] }, "approval": …, … }
//    Still loadable for comparison with earlier results; never a readiness run.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
export type StaffRoleKey = "chair" | "approval" | "admins" | "executive";
export type SupportRoleKey = Exclude<StaffRoleKey, "chair">;
export type IdentityMode = "realistic-multi-committee" | "legacy-single-committee";
export interface SessionRef { session: string }
export interface ChairRef { session: string; committee?: string }
export interface MultiCommitteeFile { mode?: "multi-committee"; chairs: ChairRef[]; approval: SessionRef; admins: SessionRef; executive: SessionRef }
export interface LegacyScopedFile { chair: { session: string; committee: string; sessions: string[] }; approval: SessionRef; admins: SessionRef; executive: SessionRef }
/** @deprecated legacy single-committee shape; kept so historical fixtures still load. */
export type ScopedFile = LegacyScopedFile;
export type IdentityFile = MultiCommitteeFile | LegacyScopedFile;
export interface Identity { userId: string; token: string }
export interface ChairIdentity extends Identity { committee: string; index: number }

export function isMultiCommittee(file: IdentityFile): file is MultiCommitteeFile {
  return Array.isArray((file as MultiCommitteeFile).chairs);
}
export function identityModeOf(file: IdentityFile): IdentityMode {
  return isMultiCommittee(file) ? "realistic-multi-committee" : "legacy-single-committee";
}
export interface FixtureCommittee { id: string; session: string; code: string }
/**
 * Readiness mapping, fail-fast. Chair identity k must be scoped to fixture committee k, every simulated committee
 * needs its own Chair identity, and no identity may serve two committees. Returns committee index → chair index.
 * Pure: checks the file's declared scopes and the loaded user ids (pass them once sessions are loaded).
 */
export function resolveChairMapping(file: MultiCommitteeFile, committees: FixtureCommittee[], chairUserIds?: string[]): number[] {
  if (!committees.length) throw Error("Fixture has no committees.");
  if (file.chairs.length < committees.length) throw Error(`Readiness mode needs one Chair identity per committee: ${file.chairs.length} Chair identities for ${committees.length} committees. Prepare more with scripts/rehearsal-identities.mts.`);
  const sessions = new Set<string>();
  const mapping = committees.map((committee, k) => {
    const chair = file.chairs[k];
    if (!chair.committee) throw Error(`Chair identity ${k} has no committee: generate the run identities with scripts/rehearsal-fixture.mts.`);
    if (chair.committee !== committee.id) throw Error(`Chair identity ${k} is scoped to ${chair.committee}, but simulated committee ${k} is ${committee.id} (${committee.code}).`);
    if (sessions.has(chair.session)) throw Error(`Chair identity ${k} reuses session file ${chair.session}: each committee needs a distinct Chair identity.`);
    sessions.add(chair.session);
    return k;
  });
  if (chairUserIds) {
    const used = mapping.map((k) => chairUserIds[k]);
    if (new Set(used).size !== used.length) throw Error("Two committees resolve to the same Chair Auth user: each committee needs a distinct Chair identity.");
  }
  return mapping;
}

async function loadSession(path: string, label: string, env: Record<string, string>): Promise<Identity> {
  let saved = JSON.parse(await readFile(path, "utf8"));
  if ((saved.expires_at ?? 0) * 1000 - Date.now() < 30 * 60_000) {
    const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.refreshSession({ refresh_token: saved.refresh_token });
    if (error || !data.session) throw Error(`Could not refresh the ${label} test session: ${error?.message}`);
    saved = data.session;
    await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
  }
  return { userId: saved.user.id, token: saved.access_token };
}

export async function loadIdentities(file: string, env: Record<string, string>) {
  const scoped = JSON.parse(await readFile(file, "utf8")) as IdentityFile;
  const mode = identityModeOf(scoped);
  const support = {} as Record<SupportRoleKey, Identity>;
  for (const role of ["approval", "admins", "executive"] as const) support[role] = await loadSession(scoped[role].session, role, env);
  const chairs: ChairIdentity[] = [];
  if (isMultiCommittee(scoped)) {
    for (const [index, chair] of scoped.chairs.entries()) chairs.push({ ...(await loadSession(chair.session, `chair ${index}`, env)), committee: chair.committee ?? "", index });
  } else {
    chairs.push({ ...(await loadSession(scoped.chair.session, "chair", env)), committee: scoped.chair.committee, index: 0 });
  }
  // `identities.chair` = the first Chair identity (snapshot probe / legacy callers).
  const identities: Record<StaffRoleKey, Identity> = { ...support, chair: chairs[0] };
  return { mode, scoped, identities, chairs };
}
