import type {Engine} from './authz-engine';
import {ACTORS, NO_EXECUTE, type Actor, type ActorKey, type ConfRole, type Fixture, type Scope} from './authz-fixture';
import type {Cmd} from './authz-catalogue';

export const lit = (value: string | null) => (value === null ? 'null' : `'${value.replaceAll("'", "''")}'`);

/** Row counts that move whenever a write function commits anything (receipts, audit, invalidation, grants, links). */
const FINGERPRINT = `(select count(*) from private.mutation_receipts)+(select count(*) from public.audit_log)
 +(select count(*) from public.operational_changes)+(select count(*) from public.user_access)
 +(select count(*) from private.access_credentials)+(select count(*) from private.access_grant_sources)
 +(select count(*) from private.access_redemption_attempts)+(select count(*) from private.resolution_submissions)
 +(select count(*) from private.amendment_submissions)+(select count(*) from public.documents)+(select count(*) from public.amendments)`;

export interface Outcome {
 /** `ok` or the SQLSTATE the call raised. */
 code: string;
 /** Rows added or changed in the fingerprint tables by the call. */
 delta: number;
 /** Result of the optional `after` probe (owner SQL scalar), or ''. */
 after: string;
 /** The returned value on success, the error message otherwise. */
 message: string;
}

export interface Attempt {
 actor: Actor;
 /** SQL expression of the call, executed as the actor's database role. */
 call: string;
 /** Owner SQL run before the call inside the cell's transaction. */
 pre?: string;
 /** Owner SQL expression stored as the precondition for `nullif(current_setting('authz.expected'),'')`. */
 expectedSql?: string;
 /** Owner SQL scalar read after the call (still inside the transaction). */
 afterSql?: string;
}

let cellCounter = 0;
export const cellsRun = () => cellCounter;

function script(a: Attempt, transaction: boolean): string {
 const {actor} = a;
 const grants = actor.modelExecute ? 'grant execute on all functions in schema public to service_role;' : '';
 return `${transaction ? 'begin;' : 'reset role;'}
  ${grants}
  ${a.pre ?? ''}
  do $d$ begin
   perform set_config('authz.expected', coalesce((${a.expectedSql ?? 'null'})::text, ''), true);
   perform set_config('authz.before', (${FINGERPRINT})::text, true);
  end $d$;
  set local request.jwt.claim.sub = ${lit(actor.sub ?? '')};
  set local role ${actor.db};
  do $d$ begin perform authz_probe.attempt(\$q\$${a.call}\$q\$); end $d$;
  reset role;
  select current_setting('authz.code') || '~~' || ((${FINGERPRINT}) - current_setting('authz.before')::bigint)::text || '~~'
   || coalesce((${a.afterSql ?? 'null'})::text, '') || '~~' || replace(replace(current_setting('authz.msg'), chr(10), ' '), chr(13), ' ');
  ${transaction ? 'rollback;' : ''}`;
}

function parse(out: string): Outcome {
 const [code, delta, after, ...rest] = out.split('~~');
 if (code === undefined || delta === undefined) throw new Error(`Unreadable probe output: ${JSON.stringify(out)}`);
 return {code, delta: Number(delta), after: after ?? '', message: rest.join('~~')};
}

/**
 * Run ONE call as one principal in a transaction that is rolled back, so thousands of cells share one database and
 * a cell's allow can never leak into the next. The call executes through authz_probe.attempt, which is SECURITY
 * INVOKER: every privilege check (EXECUTE, schema USAGE, the function's own auth.uid()/has_access checks) is the
 * real one for the principal, and an error is captured instead of aborting the transaction.
 */
export async function attempt(engine: Engine, a: Attempt): Promise<Outcome> {
 cellCounter++;
 return parse(await engine.run(script(a, true)));
}

/** A step inside a sequence() transaction; the effects of earlier steps are visible to later ones. */
export type Step = (a: Attempt) => Promise<Outcome>;
export async function sequence(engine: Engine, body: (step: Step, owner: (sql: string) => Promise<string>) => Promise<void>) {
 await engine.run('begin;');
 try {
  const step: Step = async a => { cellCounter++; return parse(await engine.run(script(a, false))); };
  const owner = (sql: string) => engine.run(`reset role; ${sql}`);
  await body(step, owner);
 } finally {
  await engine.run('rollback;').catch(() => undefined);
 }
}

// ---- call builders ------------------------------------------------------------------------------------------

export type CallTarget =
 | 'public.apply_conference_mutation' | 'public.apply_operations_mutation'
 | 'private.apply_mutation' | 'private.apply_procedure' | 'private.apply_staff_batch' | 'private.apply_operations_mutation';
/** How the optimistic precondition is supplied: the correct one, a wrong one, or none. */
export type ExpectedMode = 'valid' | 'stale' | 'none' | {literal: string | null};

export function mutationCall(target: CallTarget, conf: string, mutation: string, command: unknown, role: ConfRole, expected: ExpectedMode = 'valid') {
 const exp = expected === 'valid' ? "nullif(current_setting('authz.expected'), '')" : expected === 'stale' ? "'zz-stale'" : expected === 'none' ? 'null::text' : `${lit(expected.literal)}::text`;
 return `${target}(${lit(conf)}::uuid, ${lit(mutation)}::uuid, ${lit(JSON.stringify(command))}::jsonb, ${lit(role)}::public.conference_role, ${exp}, '2026-10-22T10:00:00Z'::timestamptz)`;
}

export const mutationId = (n: number) => `7e000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const targetFor = (cmd: Cmd): CallTarget => (cmd.router === 'conference' ? 'public.apply_conference_mutation' : 'public.apply_operations_mutation');
export const privateTargetFor = (cmd: Cmd): CallTarget =>
 ({mutation: 'private.apply_mutation', procedure: 'private.apply_procedure', batch: 'private.apply_staff_batch', operations: 'private.apply_operations_mutation'} as const)[cmd.impl];

// ---- the oracle ---------------------------------------------------------------------------------------------

export type Expectation = {allow: true} | {allow: false; code: string; reason: string};

/**
 * The documented rule, independent of the SQL under test. A call is allowed only if ALL hold: the caller is an
 * authenticated user with a JWT subject; holds a grant in THIS conference that is neither revoked nor expired;
 * the grant's role is exactly the requested role (a grant is never usable as another role); a committee-scoped
 * grant covers the command's committee (and never a conference-wide command); and the command is intended for
 * that role. The Executive (admin) and the other conference-wide roles do not inherit each other's commands.
 */
export function expectation(cmd: Pick<Cmd, 'roles' | 'scope' | 'wrongRoleCode' | 'retired'>, actor: Actor, requested: ConfRole): Expectation {
 const deny = (reason: string, code = '42501'): Expectation => ({allow: false, code, reason});
 if (actor.db !== 'authenticated') return deny(`${actor.db} cannot execute the function or has no session`);
 if (!actor.sub) return deny('no session (auth.uid() is null)');
 const grant = actor.grant;
 if (!grant) return deny('no grant');
 if (grant.conf !== 'A') return deny('grant is in another conference');
 if (grant.state !== 'active') return deny(`grant is ${grant.state}`);
 if (grant.role !== requested) return deny(`grant role ${grant.role} is not the requested role ${requested}`);
 if (grant.scope !== null && grant.scope !== cmd.scope) return deny(`grant scoped to ${grant.scope} does not reach ${cmd.scope ?? 'conference-wide'}`);
 if (!cmd.roles.includes(requested)) return deny(`${requested} is not intended for this command`, cmd.wrongRoleCode ?? '42501');
 if (cmd.retired) return deny('command is retired', '22023');
 return {allow: true};
}

/** Requested roles to try for an actor: the roles the command is intended for plus the actor's own role. */
export function requestedRoles(cmd: Pick<Cmd, 'roles'>, actor: Actor): ConfRole[] {
 const roles = new Set<ConfRole>(actor.db === 'authenticated' && actor.grant ? [actor.grant.role] : []);
 for (const role of cmd.roles) roles.add(role);
 if (!roles.size) roles.add(cmd.roles[0]);
 // Anonymous-style principals have no role of their own: only the intended request matters.
 return actor.db === 'authenticated' && actor.grant ? [...roles] : [cmd.roles[0]];
}

export interface Mismatch {cell: string; expected: string; actual: string}

/** Check one outcome against its expectation; returns a description of a mismatch, or null. */
export function judge(exp: Expectation, outcome: Outcome, writes: boolean): string | null {
 if (exp.allow) {
  if (outcome.code !== 'ok') return `expected ALLOW, got ${outcome.code}: ${outcome.message}`;
  if (writes && outcome.delta <= 0) return 'allowed but wrote nothing (no receipt)';
  return null;
 }
 if (outcome.code === 'ok') return `expected DENY ${exp.code} (${exp.reason}), but the call succeeded`;
 if (outcome.code !== exp.code) return `expected DENY ${exp.code} (${exp.reason}), got ${outcome.code}: ${outcome.message}`;
 if (outcome.delta !== 0) return `denied (${outcome.code}) but changed ${outcome.delta} fingerprint rows`;
 return null;
}

/** Run every (actor, requested role) cell of one command through one target and return the mismatches. */
export async function runCommand(engine: Engine, f: Fixture, cmd: Cmd, target: CallTarget, actorKeys: ActorKey[], seed: number) {
 const mismatches: Mismatch[] = [];
 let cells = 0;
 let n = 0;
 for (const key of actorKeys) {
  const actor: Actor = ACTORS[key];
  for (const role of requestedRoles(cmd, actor)) {
   const exp = expectation(cmd, actor, role);
   const outcome = await attempt(engine, {
    actor, call: mutationCall(target, f.confA, mutationId(seed * 100 + n++), cmd.command(f), role),
    pre: cmd.pre?.(f), expectedSql: cmd.expected?.(f),
   });
   cells++;
   const problem = judge(exp, outcome, true);
   if (problem) mismatches.push({cell: `${target} ${cmd.id} :: ${actor.name} as ${role}`, expected: exp.allow ? 'ALLOW' : `DENY ${exp.code}`, actual: problem});
   else if (!exp.allow && NO_EXECUTE.includes(key) && !/permission denied/i.test(outcome.message)) {
    mismatches.push({cell: `${target} ${cmd.id} :: ${actor.name}`, expected: 'permission denied', actual: outcome.message});
   }
  }
 }
 return {cells, mismatches};
}

export const scopeLabel = (scope: Scope) => scope ?? 'conference-wide';
