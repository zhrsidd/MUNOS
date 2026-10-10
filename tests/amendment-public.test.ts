import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import React, { createElement } from 'react';
import { AmendmentForm } from '../components/amendments/form';
import { amendmentBackend } from '../lib/amendments/backend';
import { AmendmentRejected, handleAmendment, type AmendmentBackend, type AmendmentSubmitArgs } from '../lib/amendments/service';
import { POST } from '../app/api/amendments/route';
import { isPublicPath } from '../components/conference-shell';
import type { AmendmentError, AmendmentLinkInfo } from '../lib/amendments/rules';
const token = 'a'.repeat(48);
const input = { token, submissionId: '00000000-0000-4000-8000-000000000001', submitterId: '00000000-0000-4000-8000-000000000002', resolutionId: '00000000-0000-4000-8000-000000000003', type: 'Add', clause: 'Operative clause 4', wording: 'Requests regular reporting;\nwith public summaries.', confirmed: true };
const link: AmendmentLinkInfo = { committee: { id: 'ga1', code: 'GA1', name: 'General Assembly 1' }, resolution: { id: input.resolutionId, code: 'GA1/01', title: 'International cooperation' }, delegates: [{ id: input.submitterId, country: 'France' }] };
function backend(result: 'created' | 'replayed' | 'duplicate' = 'created') {
  const sent: AmendmentSubmitArgs[] = [];
  const mock: AmendmentBackend = { async linkInfo() { return link; }, async submit(args) { sent.push(args); return { status: result, id: 'amendment-1' }; } };
  return { mock, sent };
}
for (const status of ['created', 'replayed', 'duplicate'] as const) {
  test(`amendment public service returns ${status} without creating an Auth session`, async () => {
    const { mock, sent } = backend(status);
    const result = await handleAmendment(input, mock);
    assert.equal(result.status, status === 'created' ? 201 : 200);
    assert.deepEqual(result.body, { ok: true, status, id: 'amendment-1' });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].wording, input.wording, 'exact internal whitespace is preserved');
    assert.equal(sent[0].submissionId, input.submissionId);
  });
}
test('same amendment UUID survives an ambiguous response retry', async () => {
  const { mock, sent } = backend('replayed'); const submit = mock.submit;
  let first = true;
  mock.submit = async args => { const result = await submit(args); if (first) { first = false; throw Error('Lost response after commit'); } return result; };
  assert.equal((await handleAmendment(input, mock)).status, 503);
  assert.equal((await handleAmendment(input, mock)).status, 200);
  assert.equal(sent[0].submissionId, sent[1].submissionId);
  assert.deepEqual(sent[0], sent[1]);
});
for (const [name, patch] of [
  ['missing confirmation', { confirmed: false }], ['invalid type', { type: 'Edit' }], ['empty clause', { clause: '  ' }], ['long clause', { clause: 'a'.repeat(201) }], ['empty wording', { wording: '\n' }], ['long wording', { wording: 'a'.repeat(4001) }], ['non-string wording', { wording: 123 }], ['invalid UUID', { submissionId: 'abc' }], ['invalid resolution', { resolutionId: 'abc' }], ['invalid delegation', { submitterId: 'abc' }],
] as const) {
  test(`public amendment rejects ${name} before RPC`, async () => { const { mock, sent } = backend(); assert.equal((await handleAmendment({ ...input, ...patch }, mock)).status, 400); assert.equal(sent.length, 0); });
}
for (const [reason, status] of [['invalid_link', 404], ['invalid_submitter', 400], ['not_open', 409], ['invalid_amendment', 400], ['rate_limited', 429], ['idempotency_conflict', 409]] as [AmendmentError, number][]) {
  test(`transactional ${reason} rejection reaches the delegate safely`, async () => { const { mock } = backend(); mock.submit = async () => { throw new AmendmentRejected(reason); }; const result = await handleAmendment(input, mock); assert.equal(result.status, status); assert.equal(result.body.ok, false); if (!result.body.ok) assert.equal(result.body.error, reason); });
}
test('invalid token, absent service configuration and unexpected failures fail closed', async () => {
  const { mock } = backend();
  assert.equal((await handleAmendment({ ...input, token: 'guess' }, mock)).status, 404);
  assert.equal((await handleAmendment(input, null)).status, 503);
  assert.equal(amendmentBackend({ NEXT_PUBLIC_DATA_BACKEND: 'supabase' }), null);
  assert.equal(amendmentBackend({ NEXT_PUBLIC_DATA_BACKEND: 'local' }), null);
  mock.submit = async () => { throw Error('private SQL details'); };
  const result = await handleAmendment(input, mock);
  assert.equal(result.status, 503); assert.ok(!JSON.stringify(result).includes('private SQL'));
});
test('public form shows only supplied committee/delegate fields, exact confirmation and all amendment types', () => {
  const html = renderToStaticMarkup(createElement(AmendmentForm, { token, link }));
  for (const text of ['GA1/01', 'International cooperation', 'France', 'Add', 'Strike', 'Replace', 'I confirm this is the exact wording I want submitted.']) assert.ok(html.includes(text));
  assert.ok(!html.includes('SUPABASE_SECRET_KEY'));
  const closed = renderToStaticMarkup(createElement(AmendmentForm, { token, link: { ...link, resolution: null } }));
  assert.ok(closed.includes('Amendments are not currently open in this committee.')); assert.ok(!closed.includes('<form'));
  assert.equal(isPublicPath('/amend/abc'), true); assert.equal(isPublicPath('/amend/abc/sheet'), true); assert.equal(isPublicPath('/submit/abc'), true); assert.equal(isPublicPath('/chair/amendments'), false);
});
test('before hydration the public form cannot submit natively, expose wording in the URL or lose input', () => {
  // Server HTML is exactly what a slow device shows until React attaches submit().
  const html = renderToStaticMarkup(createElement(AmendmentForm, { token, link }));
  const form = html.match(/<form[^>]*>/)![0];
  assert.match(form, /method="post"/, 'a native submission can never be a GET carrying the wording in the URL');
  assert.doesNotMatch(form, /action=/, 'no native action target');
  assert.match(html, /<fieldset disabled=""/, 'fields cannot be edited and then lost before hydration');
  assert.match(html, /<button class="primary" type="submit" disabled="">Loading form…<\/button>/, 'submit (and Enter-key implicit submission) is blocked');
  assert.equal((html.match(/type="submit"/g) ?? []).length, 1, 'no other enabled submitter');
  assert.match(html, /<p class="muted" role="status">If this form does not load, ask your Chair how to submit your amendment\.<\/p>/, 'stalled hydration (JS on, never loads) still tells the delegate what to do');
  assert.match(html, /<noscript>.*This form needs JavaScript to submit\. Ask your Chair how to submit your amendment\..*<\/noscript>/, 'never a silent dead form');
});
test('after hydration the public form is enabled and submits as before', t => {
  t.mock.method(React, 'useSyncExternalStore', ((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()) as typeof React.useSyncExternalStore);
  const html = renderToStaticMarkup(createElement(AmendmentForm, { token, link }));
  assert.doesNotMatch(html, /<fieldset disabled/);
  assert.match(html, /<button class="primary" type="submit">Submit amendment<\/button>/);
  assert.doesNotMatch(html, /Loading form…/);
  assert.doesNotMatch(html, /If this form does not load/, 'the loading fallback disappears once hydrated');
});
test('HTTP boundary bounds chunked bodies, rejects malformed JSON and reports missing configuration', async () => {
  const previous = process.env.NEXT_PUBLIC_DATA_BACKEND; process.env.NEXT_PUBLIC_DATA_BACKEND = 'local';
  try {
    const bad = await POST(new Request('http://localhost/api/amendments', { method: 'POST', body: '{' })); assert.equal(bad.status, 400);
    const huge = await POST(new Request('http://localhost/api/amendments', { method: 'POST', body: 'x'.repeat(33000) })); assert.equal(huge.status, 413);
    const unavailable = await POST(new Request('http://localhost/api/amendments', { method: 'POST', body: JSON.stringify(input) })); assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get('Cache-Control'), 'no-store');
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_BACKEND; else process.env.NEXT_PUBLIC_DATA_BACKEND = previous; }
});
test('server adapter calls only service RPCs; delegates never trigger Auth endpoints', async () => {
  const original = globalThis.fetch;
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (request, init) => {
    const path = String(request); const body = JSON.parse(String(init?.body)) as Record<string, unknown>; calls.push({ path, body });
    return Response.json(path.endsWith('/amendment_link_info') ? link : { status: 'created', id: 'amendment-1' });
  };
  try {
    const adapter = amendmentBackend({ NEXT_PUBLIC_DATA_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SECRET_KEY: 'fixture-server-only-key' })!;
    assert.deepEqual(await adapter.linkInfo(token), link);
    const { confirmed: _confirmed, ...args } = input; void _confirmed;
    await adapter.submit({ ...args, type: 'Add' });
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.path.includes('/rest/v1/rpc/') && !call.path.includes('/auth/')));
    assert.equal(calls[1].body.resolution, input.resolutionId); assert.equal(calls[1].body.submission, input.submissionId);
  } finally { globalThis.fetch = original; }
});
