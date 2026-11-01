import test from 'node:test';
import assert from 'node:assert/strict';
import { ActualClient, commandCommittee, deliverChange } from '../scripts/rehearsal/actual-client';
import { observedWorkVerdict } from '../scripts/rehearsal/readiness';
import { createSeed } from '../lib/seed';
import { applyCommand } from '../lib/commands';
import { ConflictError, type Transport } from '../lib/sync/repository';
import type { Mutation } from '../lib/sync/store';
import { MAX_BATCH, SUPPORT_REFRESH_GAP_MS } from '../lib/sync/backoff';
import type { SimUser } from '../scripts/rehearsal/scenario';
const pause = () => new Promise<void>(r => setImmediate(r));
async function until(check: () => boolean) { for (let i = 0; i < 1000; i++) { if (check()) return; await pause(); } assert.ok(check(), 'actual core did not settle'); }
const mutation = (): Mutation => ({ id: crypto.randomUUID(), actorId: 'chair-test', createdAt: new Date().toISOString(), role: 'chair', expected: null, state: 'pending', command: { type: 'participation', committeeId:'ga1', delegateId: 'd0', resolutionId: 'r1', categoryId: 'speech', points: 2 } });
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; }
class Server implements Transport {
  actorId = 'chair-test'; data = createSeed(); reads = 0; sends = 0; receipts = new Set<string>(); held?: ReturnType<typeof gate>; readError?: unknown; conflict = false;
  async read() { this.reads++; const hold = this.held; this.held = undefined; if (hold) await hold.promise; await pause(); if (this.readError) throw this.readError; return structuredClone(this.data); }
  async send(m: Mutation) { this.sends++; await pause(); if (this.conflict) throw new ConflictError('Synthetic conflict'); if (!this.receipts.has(m.id)) { this.data = applyCommand(this.data, m.command, m.role, m); this.receipts.add(m.id); } }
}
function setup(server = new Server()) { const key = crypto.randomUUID(); const client = new ActualClient({ key, seed: createSeed, transport: server, connected: true }); return { key, client, server }; }
test('rehearsal uses the shipping own-echo window while retaining foreign invalidations', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const { client, server } = setup();
  try {
    await client.open(); await until(() => !!client.snapshot && !client.busy);
    await client.execute(mutation().command, 'chair', { action: 'participation' });
    await until(() => client.pending === 0 && !client.busy);
    const id = [...server.receipts][0], reads = server.reads;
    t.mock.timers.tick(6_000);
    client.notify('chair', id); t.mock.timers.tick(350); await pause();
    assert.equal(server.reads, reads, 'the confirmation already includes this mutation');
    client.notify('chair', id); client.notify('chair', 'another-device');
    t.mock.timers.tick(350); await until(() => server.reads > reads && !client.busy);
    assert.equal(server.reads, reads + 1, 'a mixed window must still refresh');
  } finally { t.mock.timers.reset(); await client.close(); }
});
test('rehearsal forwards support refresh gaps and best-effort clock reports', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const server = new Server(); let clockReports = 0;
  const client = new ActualClient({ key: crypto.randomUUID(), seed: createSeed, transport: {
    actorId: server.actorId, passiveRefreshGapMs: SUPPORT_REFRESH_GAP_MS,
    read: () => server.read(), send: m => server.send(m), syncClock: async () => { clockReports++; },
  } });
  try {
    await client.open(); await until(() => !!client.snapshot && !client.busy);
    const reads = server.reads;
    t.mock.timers.tick(6_000); client.focus(); await pause();
    assert.equal(server.reads, reads, 'support readers retain their 15-second gap');
    t.mock.timers.tick(9_501); await until(() => server.reads === reads + 1 && !client.busy);
    await client.execute(mutation().command, 'chair', { action: 'participation' });
    await until(() => client.pending === 0 && !client.busy);
    assert.equal(clockReports, 1, 'clock evidence follows the actual send stack');
  } finally { t.mock.timers.reset(); await client.close(); }
});
test('rehearsal intent attribution survives the shipping roll-call citation', async () => {
  const server = new Server(); let action = '';
  const client = new ActualClient({ key: crypto.randomUUID(), seed: createSeed, transport: server,
    accepted: (_m, meta) => { action = meta.action; } });
  try {
    await client.open(); await until(() => !!client.snapshot && !client.busy);
    await client.execute({ type: 'queueAdd', committeeId: 'ga1', delegateId: 'd3', lane: 'open' }, 'chair', { action: 'tracked-queue' });
    await until(() => client.pending === 0 && !client.busy);
    assert.equal(action, 'tracked-queue', 'server protocol metadata must not erase the scenario action');
  } finally { await client.close(); }
});
test('actual-core adapter immediately rechecks an action recorded during its opening read', async () => {
  const { client, server } = setup(); const hold = gate(); server.held = hold;
  try { await client.open(); await until(() => server.reads === 1); await client.execute(mutation().command, 'chair', { action: 'participation' }); assert.equal(server.sends, 0); hold.release(); await until(() => client.pending === 0 && !client.busy); assert.equal(server.sends, 1); assert.equal(client.stats.maxConcurrentTransportCalls, 1); assert.equal(client.repo.getHealth().realtime, true); }
  finally { hold.release(); await client.close(); }
});
test('actual-core adapter batches queued work with actual DurableStore and distinct device databases', async () => {
  const a = setup(), b = setup();
  try {
    await a.client.store.update(a.key, () => ({ key: a.key, base: createSeed(), pending: Array.from({ length: 60 }, mutation), savedAt: new Date(0).toISOString() }));
    await Promise.all([a.client.open(), b.client.open()]);
    await until(() => a.server.sends === 60 && a.client.pending === 0 && !a.client.busy);
    assert.equal(a.server.reads, Math.ceil(60 / MAX_BATCH)); assert.equal(a.server.receipts.size, 60); assert.equal(b.server.sends, 0);
    assert.equal(a.client.stats.maxConcurrentTransportCalls, 1);
  } finally { await Promise.all([a.client.close(), b.client.close()]); }
});
test('read-back failure retains acknowledged UUIDs and honors core overload backoff for focus and new intent', async () => {
  const { client, key, server } = setup();
  server.readError = Object.assign(Error('statement timeout'), { code: '57014' });
  try {
    await client.store.update(key, () => ({ key, base: createSeed(), pending: Array.from({ length: 10 }, mutation), savedAt: new Date(0).toISOString() }));
    await client.open(); await until(() => client.repo.getHealth().errorKind === 'overload');
    assert.equal(server.sends, 10); assert.equal(client.unconfirmed, 10);
    assert.ok(Date.parse(client.repo.getHealth().retryAt!) - Date.now() > 7_000);
    client.focus(); client.notify('chair'); await client.execute(mutation().command, 'chair', { action: 'participation' });
    await pause(); await pause(); assert.equal(server.sends, 10); assert.equal(server.reads, 1);
    server.readError = undefined; client.repo.retry(); await until(() => client.pending === 0 && !client.busy);
    assert.equal(server.sends, 11, 'only the new UUID is sent; previously acknowledged actions are not replayed');
    assert.equal(server.receipts.size, 11); assert.equal(client.unconfirmed, 0);
  } finally { await client.close(); }
});
test('actual-core passive coalescing absorbs focus and simulated notifications after a fresh read', async () => {
  const { client, server } = setup();
  try { await client.open(); await until(() => !!client.snapshot && !client.busy); const reads = server.reads; client.focus(); client.focus(); client.notify('documents'); await new Promise(r => setTimeout(r, 400)); assert.equal(server.reads, reads); }
  finally { await client.close(); }
});
test('close does not dismiss conflicts or claim pending work was drained', async () => {
  const { client, key, server } = setup(); server.conflict = true;
  await client.store.update(key, () => ({ key, base: createSeed(), pending: [mutation()], savedAt: new Date(0).toISOString() }));
  await client.open(); await until(() => client.conflicts === 1); await client.close();
  assert.equal(client.pending, 1); assert.equal(client.conflicts, 1);
  assert.equal(observedWorkVerdict({ expectedDevices:1,openedDevices:1,expectedRoles: ['chair'], reads: { chair: 1 }, writes: { chair: 1 }, expectedChairCommittees: ['ga1'], observedChairCommittees: ['ga1'], pending: client.pending, conflicts: client.conflicts, unconfirmed: client.unconfirmed }).pass, false);
});
test('observed-work gate refuses empty traffic, missing role/committee and any unsettled intent', () => {
  const valid = { expectedDevices:4,openedDevices:4,expectedRoles: ['chair','approval','admins','executive'], reads: { chair: 1, approval: 1, admins: 1, executive: 1 }, writes: { chair: 1, approval: 1, admins: 1 }, expectedChairCommittees: ['a','b'], observedChairCommittees: ['a','b'], pending: 0, conflicts: 0, unconfirmed: 0 };
  assert.equal(observedWorkVerdict(valid).pass, true);
  const patches: Partial<Parameters<typeof observedWorkVerdict>[0]>[] = [{ openedDevices: 3 },{ reads: {} }, { writes: {} }, { writes: { chair: 1, approval: 1 } }, { observedChairCommittees: ['a'] }, { pending: 1 }, { conflicts: 1 }, { unconfirmed: 1 },{localRefusals:1}];
  for (const patch of patches) assert.equal(observedWorkVerdict({ ...valid, ...patch }).pass, false);
});
test('public create notifications fan out to the actual committee and support roles; document review scope comes from the document', () => {
  const users = [{ id: 0, role: 'chair', committee: 0 }, { id: 1, role: 'chair', committee: 1 }, { id: 2, role: 'approval', committee: 0 }, { id: 3, role: 'admins', committee: 0 }, { id: 4, role: 'executive', committee: 0 }, { id: 5, role: 'delegate', committee: 1 }] as SimUser[];
  const notified: number[] = []; deliverChange('topic-aware', users, { topic: 'documents', committee: 1 }, u => notified.push(u.id));
  assert.deepEqual(notified, [1,2,3,4]);
  const data = createSeed(); const doc = data.documents[0];
  assert.equal(commandCommittee(data, { type: 'document', id: doc.id, status: 'Approved' }), doc.committeeId);
});

test('a held transport cannot hang close or obtain a settled PASS', async () => {
  const { client, server } = setup(); const held = gate(); server.held = held;
  await client.open(); await until(() => server.reads === 1);
  try { assert.equal(await client.close(20), false); }
  finally { held.release(); await until(() => !client.busy); await client.store.close(); }
});
test('bounded wire fetch aborts an unresponsive request without real network', async () => {
  const { boundedFetch } = await import('../scripts/rehearsal/actual-client');
  const fake: typeof fetch = (_request, init) => new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)); });
  const keepAlive = setTimeout(() => undefined, 100);
  try { await assert.rejects(() => boundedFetch(fake, 10)('https://unused.example'), /timeout|aborted/i); }
  finally { clearTimeout(keepAlive); }
});
test('declared scoring, public workload and close timeout cannot pass vacuously', () => {
  const base = { expectedDevices:1,openedDevices:1,expectedRoles: ['chair'], reads: { chair: 1 }, writes: { chair: 1 }, expectedChairCommittees: ['a'], observedChairCommittees: ['a'], pending: 0, conflicts: 0, unconfirmed: 0 };
  assert.equal(observedWorkVerdict({ ...base, expectedActions: ['speechScore','poiScore'], actions: { speechScore: 1 } }).pass, false);
  assert.equal(observedWorkVerdict({ ...base, expectedPages: 150, completedPages: 149 }).pass, false);
  assert.equal(observedWorkVerdict({ ...base, expectedSubmissions: 16, createdSubmissions: 0 }).pass, false);
  assert.equal(observedWorkVerdict({ ...base, closeTimedOut: true }).pass, false);
});
test('current POI scoring latency contributes to the write p95 threshold', async () => {
  const { evaluate, report } = await import('../scripts/rehearsal/metrics');
  assert.equal(evaluate(report([{ action: 'poiScore', ms: 10_000, outcome: 'ok' }]), 0, 0).pass, false);
});
test('current and legacy roll-call commits contribute to the write p95 threshold', async () => {
  const { evaluate, report } = await import('../scripts/rehearsal/metrics');
  for (const action of ['rollCallCommit', 'rollCall']) {
    assert.equal(evaluate(report([{ action, ms: 10_000, outcome: 'ok' }]), 0, 0).pass, false, `${action} must not bypass the write limit`);
    assert.equal(evaluate(report([{ action, ms: 200, outcome: 'ok' }]), 0, 0).pass, true);
  }
});
test('synthetic fixture SQL replays with valid sessions, workflow documents and the current allowance-recognize-score flow', async () => {
  const { buildFixture } = await import('../scripts/rehearsal/fixture');
  const { freshDatabase } = await import('./helpers/database');
  const users = ['71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004'];
  const conf = '71000000-0000-4000-8000-000000000005';
  const fixture = buildFixture({ mode: 'multi-committee', conference: conf, committees: 1, delegates: 3, grantHours: 1, users: { chairs: [users[0]], approval: users[1], admins: users[2], executive: users[3] } });
  const { db, query, asOwner, as } = await freshDatabase();
  try {
    await asOwner(); for (const user of users) await db.query('insert into auth.users(id) values($1)', [user]);
    await db.exec(fixture.sql);
    const c = fixture.committees[0];
    assert.equal((await query<{ n: number }>('select count(*)::int n from public.roll_call where committee_id=$1 and state=$2',[c.id,'committed']))[0].n,1,'a committed roll call: presence without a selected session');
    assert.deepEqual((await query<{status:string}>('select status from public.documents where conference_id=$1 order by status',[conf])).map(d=>d.status),['Draft','Review','Approved','In Debate']);
    assert.equal((await query('select * from public.resolution_links where conference_id=$1',[conf])).length,4);
    await as(users[0]);
    const snapshot = async () => (await query<{s: ReturnType<typeof createSeed>}>('select public.conference_state_snapshot($1) s',[conf]))[0].s;
    const { fingerprint } = await import('../lib/sync/repository');
    const send = async (command: import('../lib/commands').Command) => { const data = await snapshot(); await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[conf,crypto.randomUUID(),JSON.stringify(command),'chair',fingerprint(data,command),new Date().toISOString()]); };
    const [speaker,asker] = fixture.delegates;
    await send({type:'speechStart',committeeId:c.id,delegateId:speaker.id,resolutionId:fixture.workflowDocuments.find(d=>d.status==='In Debate')!.id,classification:'Other'});
    const speech = (await snapshot()).speeches!.find(s=>s.state==='speaking')!;
    await send({type:'poiAllowance',committeeId:c.id,speechId:speech.id,limit:2});
    assert.equal((await snapshot()).speeches!.find(s=>s.id===speech.id)!.state,'pois');
    await send({type:'poiAdd',committeeId:c.id,speechId:speech.id,delegateId:asker.id});
    const entry = (await snapshot()).poiQueue![0];
    await send({type:'poiRecognize',committeeId:c.id,speechId:speech.id,entryId:entry.id});
    assert.ok((await snapshot()).poiQueue![0].recognizedAt);
    await send({type:'poiScore',committeeId:c.id,speechId:speech.id,entryId:entry.id,points:2});
    assert.equal((await snapshot()).events.filter(e=>e.categoryId==='poi').length,1);
    const draft=fixture.workflowDocuments.find(d=>d.status==='Draft')!;
    await send({type:'document',id:draft.id,status:'Submitted'});
    await as(users[1]);
    const {reviewableDocument}=await import('../scripts/rehearsal/actual-client');
    assert.ok(reviewableDocument(await snapshot()),'both Submitted and seeded Review are actionable');
    const decide=async(id:string,status:'Approved'|'Printed',role:'approval'|'logistics')=>{const data=await snapshot();const command={type:'document' as const,id,status};await db.query('select public.apply_conference_mutation($1,$2,$3,$4,$5,$6)',[conf,crypto.randomUUID(),JSON.stringify(command),role,fingerprint(data,command),new Date().toISOString()]);};
    await decide(draft.id,'Approved','approval');
    await decide(fixture.workflowDocuments.find(d=>d.status==='Review')!.id,'Approved','approval');
    await as(users[2]);await decide(draft.id,'Printed','logistics');
    assert.equal((await snapshot()).documents.find(d=>d.id===draft.id)?.status,'Printed');

  } finally { await db.close(); }
});

test('closing during a send prevents an optional retry probe from starting afterward', async () => {
  const { client, server } = setup();
  await client.open(); await until(() => !!client.snapshot && !client.busy);
  const held = gate(); let entered = false; const original = server.send.bind(server);
  server.send = async m => { entered = true; await held.promise; return original(m); };
  await client.execute(mutation().command, 'chair', { action: 'participation', retry: true });
  await until(() => entered);
  try { assert.equal(await client.close(20), false); }
  finally { held.release(); await until(() => !client.busy); await client.store.close(); }
  assert.equal(server.sends, 1, 'no new retry probe originates after close');
});

test('public workload token must bind to the selected fixture committee without exposing its value', async () => {
  const { assertSubmissionBinding } = await import('../scripts/rehearsal/readiness');
  const token = 'private-fixture-token';
  assert.doesNotThrow(() => assertSubmissionBinding([{ token, committeeId: 'a' }], token, 'a'));
  for (const links of [undefined, [], [{ token, committeeId: 'b' }], [{ token: 'other', committeeId: 'a' }]]) {
    assert.throws(() => assertSubmissionBinding(links, token, 'a'), error => error instanceof Error && !error.message.includes(token));
  }
});


test('record ownership partitions Chair roll call and document review without overlapping actors',async()=>{
 const {ownsWorkItem,reviewableDocument}=await import('../scripts/rehearsal/actual-client');
 const users=Array.from({length:3},(_,id)=>({id,role:'approval',committee:0,start:0,steps:[]})) as SimUser[];
 for(let n=0;n<50;n++)assert.equal(users.filter(u=>ownsWorkItem(`document-${n}`,u,users)).length,1);
 const data=createSeed();data.documents=[{...data.documents[0],status:'Review'}];
 assert.equal(reviewableDocument(data)?.status,'Review');assert.equal(reviewableDocument(data,()=>false),undefined);
});

test('the conference gate cannot be claimed by a short/small run or a missing public workload',async()=>{
 const {conferenceGateProfile}=await import('../scripts/rehearsal/readiness');
 const full={staffStages:[110],minutes:30,committees:19,delegates:150,submissionsPerStage:[16],staffRolesPerStage:[{chair:75,approval:20,admins:10,executive:5}]};
 assert.equal(conferenceGateProfile(full).eligible,true);
 for(const patch of [{minutes:5},{staffStages:[50]},{committees:14},{delegates:0},{submissionsPerStage:[0]},{staffStages:[25,110],submissionsPerStage:[16,16]}])assert.equal(conferenceGateProfile({...full,...patch}).eligible,false);
});

test('healthy partial-committee warm-ups can pass diagnostics without passing readiness',async()=>{
 const {assessReadiness,readinessVerdict,rampVerdict,observedWorkVerdict}=await import('../scripts/rehearsal/readiness');
 const metrics={pass:true,checks:[{check:'latency',pass:true}]};
 const traffic=[{committeeId:'a',committeeCode:'GA1',identity:'one'}];
 const readiness=assessReadiness({mode:'realistic-multi-committee',committees:[{id:'a',session:'sa',code:'GA1'},{id:'b',session:'sb',code:'WHO'}],chairTraffic:traffic});
 const options={expectedDevices:1,openedDevices:1,expectedRoles:['chair'],reads:{chair:1},writes:{chair:1},expectedChairCommittees:['a'],observedChairCommittees:['a'],pending:0,conflicts:0,unconfirmed:0};
 const work=observedWorkVerdict(options);
 assert.equal(work.pass,true);
 assert.equal(rampVerdict(metrics,work.checks,'realistic-multi-committee').pass,true);
 assert.equal(readinessVerdict(metrics,readiness).pass,false,'a healthy partial ramp cannot become readiness evidence');
 for(const patch of [{observedChairCommittees:[]},{observedChairCommittees:['a','b']},{conflicts:1},{unconfirmed:1},{pending:1}])
  assert.equal(rampVerdict(metrics,observedWorkVerdict({...options,...patch}).checks,'realistic-multi-committee').pass,false);
 assert.equal(rampVerdict({checks:[{check:'latency',pass:false}]},work.checks,'realistic-multi-committee').pass,false);
 assert.equal(rampVerdict(metrics,work.checks,'legacy-single-committee').pass,false);
});
