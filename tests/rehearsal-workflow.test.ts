import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFixture, fixtureJson } from '../scripts/rehearsal/fixture';
import { buildScenario } from '../scripts/rehearsal/scenario';
import { draftRequirements, workflowPreflight, pendingDiagnostics } from '../scripts/rehearsal/workflow';
import { createSeed } from '../lib/seed';
import type { SimUser } from '../scripts/rehearsal/scenario';
const conf = '22222222-2222-4222-8222-222222222222';
const options = { mode: 'multi-committee' as const, conference: conf, committees: 19, delegates: 420, grantHours: 3,
  users: { chairs: Array.from({ length: 19 }, (_, i) => `c1000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
    approval: 'a1000000-0000-4000-8000-000000000001', admins: 'a2000000-0000-4000-8000-000000000001', executive: 'a3000000-0000-4000-8000-000000000001' } };
test('fixture Draft reserves support the full ramp and full run without resetting workflow history', () => {
  const ramp = [10, 25, 50, 80].map(staff => buildScenario({ staff, staffProfile: 'dcmun-2026', minutes: 5, committees: 19 }));
  const required = draftRequirements(ramp, 19);
  assert.equal(required[0], 4); assert.equal(required[5], 4);
  const f = buildFixture({ ...options, draftsPerCommittee: Math.max(...required) });
  assert.equal(f.workflowDocuments.filter(d => d.status === 'Draft').length, 19 * 4);
  assert.equal(f.workflowDocuments.filter(d => d.status === 'Review').length, 19);
  assert.equal(fixtureJson(f).draftsPerCommittee, 4);
  assert.deepEqual(buildFixture(options), buildFixture({ ...options, draftsPerCommittee: 1 }), 'legacy fixture generation stays stable');
  for (const draftsPerCommittee of [0, -1, 1.5, 101]) assert.throws(() => buildFixture({ ...options, draftsPerCommittee }), /Draft reserve/);
});
test('read-only stage preflight refuses exhausted or missing workflow prerequisites by committee', () => {
  const scenario = [{ id: 0, role: 'chair', committee: 0, steps: [{ at: 1, action: 'sendToApproval' }] }] as SimUser[];
  const committees = [{ id: 'ga1', code: 'GA1', session: 's1' }];
  const data = createSeed();
  data.documents = data.documents.filter(d => d.committeeId === 'ga1');
  data.documents[0].status = 'Draft';
  const original = JSON.stringify(data);
  assert.equal(workflowPreflight(scenario, committees, [data]).pass, true);
  assert.equal(JSON.stringify(data), original, 'preflight never manufactures workflow');
  for (const doc of data.documents) if (doc.status === 'Draft') doc.status = 'Submitted';
  const exhausted = workflowPreflight(scenario, committees, [data]);
  assert.equal(exhausted.pass, false); assert.match(exhausted.reasons.join(' '), /GA1.*Draft/);
  assert.equal(workflowPreflight(scenario, committees, []).pass, false, 'missing snapshot is not a valid fixture');
});
test('pending diagnostics are bounded and omit command bodies, identities, contacts and raw server errors', () => {
  const pending = Array.from({ length: 150 }, (_, i) => ({ type: 'document', state: i ? 'pending' : 'conflict', expected: '1',
    message: 'Bearer secret-value someone@example.com', command: { type: 'document', token: 'secret-value', title: 'private title' } }));
  const report = pendingDiagnostics([{ device: 3, role: 'chair', committee: 'GA1', pending }], 100);
  assert.equal(report.total, 150); assert.equal(report.items.length, 100); assert.equal(report.truncated, 50);
  assert.deepEqual(report.items[0], { device: 3, role: 'chair', committee: 'GA1', command: 'document', state: 'conflict', reason: 'needs_review' });
  assert.doesNotMatch(JSON.stringify(report), /secret-value|someone@|private title|Bearer/);
});
