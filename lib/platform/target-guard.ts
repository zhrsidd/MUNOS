import lifecycleRegistry from '../../config/project-lifecycle.json';
// Target-identity guard. It decides which Supabase project a build, the health probe or an operator tool may talk to, and it
// fails CLOSED: a missing, malformed or contradictory configuration refuses; it never falls back to a permissive default.
// It never logs or returns secret values, and error text names project refs only (they are public in the URL).
export type Env = Record<string, string | undefined>;
export type TargetCheck = { ok: true; ref: string } | { ok: false; ref: string | null; reason: string };

/** The PHESMUN production project. DCMUN and MUNOS must never connect to it, in any environment, by any override. */
export const PHESMUN_PRODUCTION_REF = "gglltljhdpkfjnyjmnif";
export const NEVER_SUPABASE_REFS: readonly string[] = [PHESMUN_PRODUCTION_REF];

const REF = /^[a-z0-9]{20}$/;

/** Project ref of a hosted Supabase URL (https://<ref>.supabase.co), else null. Credentials, ports and other hosts are refused. */
export function supabaseRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
    return /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Comma-separated refs. Blank entries are ignored; any non-ref entry is a configuration error (never silently skipped). */
export function parseRefs(value: string | undefined, name: string): string[] {
  const out: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!REF.test(entry)) throw Error(`${name} contains an invalid project ref`);
    if (!out.includes(entry)) out.push(entry);
  }
  return out;
}

export interface TargetConfig {
  /** The single production project (EXPECTED_SUPABASE_REF), if configured. */
  production: string | null;
  staging: string[];
  development: string[];
}

/** Read and validate the target configuration. Throws on malformed or contradictory values. */
export function targetConfig(env: Env): TargetConfig {
  const expected = (env.EXPECTED_SUPABASE_REF ?? "").trim();
  if (expected && !REF.test(expected)) throw Error("EXPECTED_SUPABASE_REF is not a valid project ref");
  const staging = parseRefs(env.STAGING_SUPABASE_REFS, "STAGING_SUPABASE_REFS");
  const development = parseRefs(env.DEVELOPMENT_SUPABASE_REFS, "DEVELOPMENT_SUPABASE_REFS");
  const roles: [string, string[]][] = [["EXPECTED_SUPABASE_REF", expected ? [expected] : []], ["STAGING_SUPABASE_REFS", staging], ["DEVELOPMENT_SUPABASE_REFS", development]];
  for (let i = 0; i < roles.length; i++) for (let j = i + 1; j < roles.length; j++) {
    const shared = roles[i][1].find((ref) => roles[j][1].includes(ref));
    if (shared) throw Error(`${roles[i][0]} and ${roles[j][0]} list the same project; a project has exactly one role`);
  }
  const never = [...expected ? [expected] : [], ...staging, ...development].find((ref) => NEVER_SUPABASE_REFS.includes(ref));
  if (never) throw Error("A forbidden project is listed in the target configuration");
  return { production: expected || null, staging, development };
}

const refuse = (ref: string | null, reason: string): TargetCheck => ({ ok: false, ref, reason });

function hosted(url: string | undefined): { ref: string } | TargetCheck {
  if (!url) return refuse(null, "NEXT_PUBLIC_SUPABASE_URL is not set");
  const ref = supabaseRef(url);
  if (!ref) return refuse(null, "NEXT_PUBLIC_SUPABASE_URL is not a hosted Supabase project URL");
  if (NEVER_SUPABASE_REFS.includes(ref)) return refuse(ref, `${ref} is the PHESMUN production project, which this deployment must never use`);
  return { ref };
}

/** A Production build or probe: the URL must be exactly the configured production project. No expectation configured means refuse. */
export function checkProductionTarget(url: string | undefined, env: Env): TargetCheck {
  const target = hosted(url);
  if ("ok" in target) return target;
  let config: TargetConfig;
  try { config = targetConfig(env); } catch (error) { return refuse(target.ref, (error as Error).message); }
  if (!config.production) return refuse(target.ref, "EXPECTED_SUPABASE_REF is not set; a Production build requires it");
  if (target.ref !== config.production) return refuse(target.ref, `${target.ref} is not the configured production project`);
  return { ok: true, ref: target.ref };
}

/**
 * Load, rehearsal, fixture and verification tools. They may only reach a project explicitly listed as staging or development,
 * never the production project, and never when no allow-list is configured.
 */
export function checkToolTarget(url: string | undefined, env: Env): TargetCheck {
  const target = hosted(url);
  if ("ok" in target) return target;
  let config: TargetConfig;
  try { config = targetConfig(env); } catch (error) { return refuse(target.ref, (error as Error).message); }
  if (config.production === target.ref) return refuse(target.ref, `${target.ref} is the production project; load and verification tools are never run against it`);
  if (!config.staging.includes(target.ref) && !config.development.includes(target.ref)) return refuse(target.ref, `${target.ref} is not listed in STAGING_SUPABASE_REFS or DEVELOPMENT_SUPABASE_REFS`);
  return { ok: true, ref: target.ref };
}

/** Owner-reviewed, unsigned source record. Environment allow-lists cannot override production or an unknown ref.
 * Old checkouts are not fresh authority: the database marker and test-purpose denial remain required at runtime. */
export function checkRegisteredToolTarget(url: string | undefined, env: Env): TargetCheck {
  const result=checkToolTarget(url,env);
  if(!result.ok)return result;
  const project=(lifecycleRegistry.projects as Record<string,{phase:string}>)[result.ref];
  if(lifecycleRegistry.version!==1||!project||!['preproduction','rehearsal'].includes(project.phase))
    return refuse(result.ref,`${result.ref} is production or unknown in the owner-controlled lifecycle record`);
  return result;
}

/** For operator scripts: throws before any connection is made. Returns the verified project ref. */
export function assertToolTarget(url: string | undefined, env: Env = process.env): string {
  const result = checkRegisteredToolTarget(url, env);
  if (!result.ok) throw Error(`Target guard refused: ${result.reason}. Nothing was contacted.`);
  return result.ref;
}

/**
 * Why a deployment must not use this Supabase URL, or null if it may. Used at the build, the health probe and the server
 * backends. The PHESMUN production project is always refused. Vercel Production must use exactly the configured production
 * project. Every other Vercel environment (Preview, Development) follows the non-production policy of the operator tools: an
 * explicitly allow-listed staging or development project, never the production one, and nothing when no list is set
 * (audit F1). A local build (no VERCEL_ENV) is not a cloud deployment and is checked only for the forbidden project.
 */
export function targetProblem(url: string | undefined, env: Env): string | null {
  const ref = supabaseRef(url);
  if (ref && NEVER_SUPABASE_REFS.includes(ref)) return "forbidden project";
  if (env.VERCEL_ENV === "production") {
    const result = checkProductionTarget(url, env);
    if (!result.ok) return result.reason;
  } else if (env.VERCEL_ENV) {
    const result = checkRegisteredToolTarget(url, env);
    if (!result.ok) return `${env.VERCEL_ENV} deployment refused: ${result.reason}`;
  }
  return null;
}
