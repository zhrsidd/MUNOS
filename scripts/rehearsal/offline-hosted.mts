// Hosted-mode support for scripts/rehearsal/offline-multi-device.mjs: preflight guards, a read-only Executive view of the
// server state, and a helper that mints role codes through the app's own code (lib/access-codes), like smoke-project.mts.
//
// SAFETY MODEL. The rehearsal writes real records (attendance, speeches, points, votes). It may therefore run ONLY against an
// isolated, temporary, clearly labelled TEST conference on a staging project. Every guard below fails closed and runs BEFORE any
// browser opens. Nothing here prints a code, key or token: only project refs, conference/committee ids and pass marks.
//
// Environment (read, never printed):
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, NEXT_PUBLIC_CONFERENCE_ID   the target the deployed app was built for
//   STAGING_SUPABASE_REFS                              allow-list; the target ref MUST be in it (development-only refs are refused)
//   REHEARSAL_CONFIRM_TEMP_CONFERENCE_ID               must equal NEXT_PUBLIC_CONFERENCE_ID: the operator's typed confirmation
//   REHEARSAL_EXEC_CODE                                Executive code of THAT temporary conference (used to read state; mints codes)
//   REHEARSAL_COMMITTEE_CODE                           committee code of the fixture (default TST)
// CLI (mint a Chair code into a private file, print ids only):
//   REHEARSAL_CODES_FILE=/private/path.json node --import tsx scripts/rehearsal/offline-hosted.mts mint
import assert from 'node:assert/strict';
import {chmod, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {assertToolTarget, parseRefs} from '../../lib/platform/target-guard';
import {redeemStaffCode, rotateAccessCode} from '../../lib/access-codes';
import {SupabaseTransport} from '../../lib/supabase/repository';
import type {ConferenceData, Role} from '../../lib/domain';

export interface HostedConfig {url: string; key: string; conferenceId: string; execCode: string; committeeCode: string; ref: string}
export interface HostedPreflight {config: HostedConfig; committeeId: string; conferenceName: string; readServer: () => Promise<ConferenceData>; exec: SupabaseClient; execId: string}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARKER = /\b(test|temporary|temp)\b/i;
const MAX_COMMITTEES = Number(process.env.REHEARSAL_MAX_COMMITTEES ?? 5);

/** Offline checks only (no network). Throws before anything is contacted. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): HostedConfig {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_CONFERENCE_ID', 'STAGING_SUPABASE_REFS', 'REHEARSAL_CONFIRM_TEMP_CONFERENCE_ID', 'REHEARSAL_EXEC_CODE'].filter(name => !env[name]);
  if (missing.length) throw Error(`Hosted rehearsal refused: missing environment ${missing.join(', ')}. Nothing was contacted.`);
  const url = env.NEXT_PUBLIC_SUPABASE_URL!;
  // The shared target guard: hosted https project only, never PHESMUN production, never the configured production ref,
  // and (below) the ref must be in STAGING_SUPABASE_REFS specifically.
  const ref = assertToolTarget(url, env);
  if (!parseRefs(env.STAGING_SUPABASE_REFS, 'STAGING_SUPABASE_REFS').includes(ref)) {
    throw Error(`Hosted rehearsal refused: project ${ref} is not listed in STAGING_SUPABASE_REFS. Nothing was contacted.`);
  }
  const conferenceId = env.NEXT_PUBLIC_CONFERENCE_ID!;
  if (env.REHEARSAL_CONFIRM_TEMP_CONFERENCE_ID !== conferenceId) {
    throw Error('Hosted rehearsal refused: REHEARSAL_CONFIRM_TEMP_CONFERENCE_ID does not equal NEXT_PUBLIC_CONFERENCE_ID. Nothing was contacted.');
  }
  return {url, key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, conferenceId, execCode: env.REHEARSAL_EXEC_CODE!, committeeCode: env.REHEARSAL_COMMITTEE_CODE || 'TST', ref};
}

const device = (config: HostedConfig) => createClient(config.url, config.key, {auth: {persistSession: false, autoRefreshToken: false}});

/** Network preflight: redeem the Executive code, then refuse unless this is an isolated, labelled TEMPORARY test conference. */
export async function preflight(config: HostedConfig = readConfig()): Promise<HostedPreflight> {
  const exec = device(config);
  assert.equal(await redeemStaffCode(exec, config.conferenceId, config.execCode), 'ok', 'Executive code was not accepted for this conference');
  const execId = (await exec.auth.getSession()).data.session!.user.id;
  const transport = new SupabaseTransport(exec, config.conferenceId, execId, [], false, ['admin']);
  const data = await transport.read();
  if (data.conference.id !== config.conferenceId) throw Error('Hosted rehearsal refused: the snapshot is not for the configured conference.');
  if (!MARKER.test(data.conference.name) && !MARKER.test(data.conference.venue)) {
    throw Error(`Hosted rehearsal refused: conference ${config.conferenceId} is not marked as TEST/temporary in its name or venue.`);
  }
  if (data.committees.length > MAX_COMMITTEES) {
    throw Error(`Hosted rehearsal refused: ${data.committees.length} committees is not an isolated rehearsal conference (limit ${MAX_COMMITTEES}).`);
  }
  const committee = data.committees.find(c => c.code === config.committeeCode && !c.archived);
  if (!committee) throw Error(`Hosted rehearsal refused: committee ${config.committeeCode} does not exist in the temporary conference.`);
  const delegates = data.delegates.filter(d => d.committeeId === committee.id);
  if (delegates.length < 5) throw Error(`Fixture needs at least 5 delegates in ${committee.code}; found ${delegates.length}.`);
  if (!data.sessions.some(s => s.committeeId === committee.id && !s.archived)) throw Error(`Fixture needs a session in ${committee.code}.`);
  if (!committee.currentSessionId) throw Error(`Fixture needs the current session of ${committee.code} to be set.`);
  if (process.env.REHEARSAL_SKIP_VOTES !== '1' && !data.documents.some(d => d.committeeId === committee.id && d.status === 'In Debate')) {
    throw Error(`Fixture needs a resolution In Debate in ${committee.code} for the voting checks (or set REHEARSAL_SKIP_VOTES=1).`);
  }
  return {config, committeeId: committee.id, conferenceName: data.conference.name, readServer: () => transport.read(), exec, execId};
}

/** Mint a role code with the Executive device. The code goes to the caller; callers never print it. */
export async function mintRoleCode(pre: HostedPreflight, role: Role, committeeId: string | null, hours = 6): Promise<string> {
  return rotateAccessCode(pre.exec, pre.config.conferenceId, role, committeeId, new Date(Date.now() + hours * 3600_000).toISOString());
}

/**
 * Authoritative server view for event-level checks. The Executive snapshot does not carry Chair-level rows (events, speeches,
 * votes), so a third, read-only Chair identity (never used for writes) reads the committee's state through SupabaseTransport.
 */
export async function chairAuditor(pre: HostedPreflight, chairCode: string): Promise<() => Promise<ConferenceData>> {
  const client = device(pre.config);
  assert.equal(await redeemStaffCode(client, pre.config.conferenceId, chairCode), 'ok', 'Chair code was not accepted for the auditor device');
  const id = (await client.auth.getSession()).data.session!.user.id;
  const transport = new SupabaseTransport(client, pre.config.conferenceId, id, [pre.committeeId], false, ['chair']);
  return () => transport.read();
}

/** Read the Chair code the rehearsal uses: environment first, then a private codes file. */
export async function chairCodeFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  if (env.REHEARSAL_CHAIR_CODE) return env.REHEARSAL_CHAIR_CODE;
  if (env.REHEARSAL_CODES_FILE) {
    const parsed = JSON.parse(await readFile(env.REHEARSAL_CODES_FILE, 'utf8')) as {chair?: string};
    return parsed.chair ?? null;
  }
  return null;
}

async function cli() {
  if (process.argv[2] !== 'mint') throw Error('usage: offline-hosted.mts mint  (see the header for the environment)');
  const file = process.env.REHEARSAL_CODES_FILE;
  if (!file) throw Error('REHEARSAL_CODES_FILE is required: a path OUTSIDE the repository for the private codes file.');
  const resolved = path.resolve(file);
  if (resolved === ROOT || resolved.startsWith(ROOT + path.sep)) throw Error('REHEARSAL_CODES_FILE must be outside the repository so codes cannot be committed.');
  const pre = await preflight();
  const chair = await mintRoleCode(pre, 'chair', pre.committeeId);
  await writeFile(resolved, JSON.stringify({chair, conference: pre.config.conferenceId, committee: pre.committeeId}), {mode: 0o600});
  await chmod(resolved, 0o600);
  console.log(JSON.stringify({project: pre.config.ref, conference: pre.config.conferenceId, committee: pre.committeeId, minted: ['chair'], file: resolved}, null, 1));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli().catch(error => { console.error(error instanceof Error ? error.message : 'failed'); process.exit(1); });
}
