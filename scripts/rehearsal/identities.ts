// Role-scoped rehearsal identities: pre-authorized sessions, one per staff role, each holding ONLY that role's grant.
// Sessions near expiry are refreshed (same Auth session, new access token) before a run. Never signs anyone in.
import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
export type StaffRoleKey = "chair" | "approval" | "admins" | "executive";
export interface ScopedFile { chair: { session: string; committee: string; sessions: string[] }; approval: { session: string }; admins: { session: string }; executive: { session: string } }
export interface Identity { userId: string; token: string }
export async function loadIdentities(file: string, env: Record<string, string>) {
  const scoped = JSON.parse(await readFile(file, "utf8")) as ScopedFile;
  const identities = {} as Record<StaffRoleKey, Identity>;
  for (const role of ["chair", "approval", "admins", "executive"] as const) {
    const path = scoped[role].session;
    let saved = JSON.parse(await readFile(path, "utf8"));
    if ((saved.expires_at ?? 0) * 1000 - Date.now() < 30 * 60_000) {
      const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await client.auth.refreshSession({ refresh_token: saved.refresh_token });
      if (error || !data.session) throw Error(`Could not refresh the ${role} test session: ${error?.message}`);
      saved = data.session;
      await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
    }
    identities[role] = { userId: saved.user.id, token: saved.access_token };
  }
  return { scoped, identities };
}
