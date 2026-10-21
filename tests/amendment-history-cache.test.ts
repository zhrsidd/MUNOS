import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Amendment } from '../lib/batch/types';
import type { Delegate, Resolution } from '../lib/domain';
import { mergePassed, groupByResolution } from '../lib/amendments/history';
import { HISTORY_CACHE_LIMIT, HistoryCache, historyCacheKey, historyContext, mergeCache, usableCache } from '../lib/amendments/history-cache';

// Audit F2 (20 October): passed history fetched online must survive an offline reload after its resolution leaves the snapshot.
const DOC = 'a'.repeat(44);
const row = (id: string, over: Partial<Amendment> = {}): Amendment => ({ id, committeeId: 'ga1', resolutionId: 'r1', sessionId: 's1', submitterId: 'd1', type: 'Add', clause: 'Operative clause 3', wording: `Exact wording ${id}`, status: 'Closed', outcome: 'Passed', createdAt: `2026-11-05T09:${id.padStart(2, '0').slice(-2)}:00.000Z`, revision: 1, ...over });
const resolution = { id: 'r1', committeeId: 'ga1', sessionId: 's1', code: 'GA1 / 01', title: 'Safeguarding civilians', submitterId: 'd1', status: 'Closed', versionIds: [], copies: 15, comments: [] } as Resolution;
const delegate = { id: 'd1', committeeId: 'ga1', schoolId: 'x', country: 'France', flag: '🇫🇷', name: 'A', email: 'a@example.com' } as Delegate;
const now = new Date('2026-11-05T12:00:00Z');

test('history cache: merges by id, keeps only this committee’s passed rows, newest first and bounded', () => {
 const context = historyContext([row('1')], [resolution], [delegate], [{ documentId: 'r1', workingDocId: DOC }]);
 assert.deepEqual(context, { resolutions: { r1: { code: 'GA1 / 01', title: 'Safeguarding civilians', country: 'France' } }, delegations: { d1: { flag: '🇫🇷', country: 'France' } }, workingDocs: { r1: DOC } });
 assert.deepEqual(historyContext([row('1')], [], [], [{ documentId: 'r1', workingDocId: 'https://evil.example/doc' }]).workingDocs, {}, 'only a valid Doc id is kept');
 const first = mergeCache(undefined, 'k', 'ga1', [row('1'), row('2', { committeeId: 'who' }), row('3', { outcome: 'Failed' }), row('4', { status: 'In Debate', outcome: null })], context, now);
 assert.deepEqual(first.rows.map(r => r.id), ['1']);
 const second = mergeCache(first, 'k', 'ga1', [row('1', { revision: 2, wording: 'Corrected' }), row('5')], context, now);
 assert.deepEqual(second.rows.map(r => [r.id, r.wording]), [['5', 'Exact wording 5'], ['1', 'Corrected']], 'newest first; newer revision wins');
 const many = Array.from({ length: HISTORY_CACHE_LIMIT + 20 }, (_, i) => row(`m${i}`, { createdAt: new Date(Date.UTC(2026, 10, 5, 8, 0, i)).toISOString(), resolutionId: i < 20 ? 'old' : 'r1' }));
 const bounded = mergeCache(undefined, 'k', 'ga1', many, { ...context, resolutions: { ...context.resolutions, old: { code: 'GA1 / 00', title: 'Old' } } }, now);
 assert.equal(bounded.rows.length, HISTORY_CACHE_LIMIT);
 assert.ok(!bounded.rows.some(r => r.resolutionId === 'old'), 'the oldest rows are dropped first');
 assert.deepEqual(Object.keys(bounded.context.resolutions), ['r1'], 'context for dropped rows is discarded');
});

test('history cache: entries expire after 14 days', () => {
 const entry = mergeCache(undefined, 'k', 'ga1', [row('1')], historyContext([row('1')], [resolution], [delegate], []), new Date('2026-11-01T00:00:00Z'));
 assert.equal(usableCache(entry, new Date('2026-11-05T00:00:00Z')).rows.length, 1);
 assert.equal(usableCache(entry, new Date('2026-11-16T00:00:00Z')).rows.length, 0);
 assert.deepEqual(mergeCache(entry, 'k', 'ga1', [row('2')], historyContext([], [], [], []), new Date('2026-11-16T00:00:00Z')).rows.map(r => r.id), ['2'], 'an expired entry is not carried forward');
 assert.deepEqual(usableCache(undefined), { rows: [], context: { resolutions: {}, delegations: {}, workingDocs: {} } });
});

test('history cache in IndexedDB: survives a reload, is scoped by actor and committee, and concurrent saves keep both pages', async () => {
 const name = `history-cache-test-${Date.now()}`;
 const actorA = historyCacheKey('actor-a', 'conf', 'ga1'), actorB = historyCacheKey('actor-b', 'conf', 'ga1'), otherCommittee = historyCacheKey('actor-a', 'conf', 'who');
 const cache = new HistoryCache(name);
 const pageOne = Array.from({ length: 50 }, (_, i) => row(`p1-${i}`, { createdAt: new Date(Date.UTC(2026, 10, 5, 10, 0, 50 - i)).toISOString() }));
 const pageTwo = Array.from({ length: 25 }, (_, i) => row(`p2-${i}`, { createdAt: new Date(Date.UTC(2026, 10, 5, 9, 0, 25 - i)).toISOString() }));
 const context = historyContext([...pageOne, ...pageTwo], [resolution], [delegate], [{ documentId: 'r1', workingDocId: DOC }]);
 await Promise.all([cache.save(actorA, 'ga1', pageOne, context, now), cache.save(actorA, 'ga1', pageTwo, context, now)]);
 await cache.close();

 // "Reload offline": a new instance, a snapshot that no longer carries the closed resolution's amendments, no fetch.
 const reloaded = new HistoryCache(name);
 const { rows, context: stored } = usableCache(await reloaded.read(actorA), now);
 assert.equal(rows.length, 75, 'both pages kept (more than one 50-row page)');
 const shown = groupByResolution(mergePassed('ga1', rows, [], []), []);
 assert.equal(shown[0].amendments.find(a => a.id === 'p2-3')?.wording, 'Exact wording p2-3', 'exact wording recovered');
 assert.deepEqual([stored.resolutions.r1.code, stored.delegations.d1.country, stored.workingDocs.r1], ['GA1 / 01', 'France', DOC], 'metadata recovered');
 assert.equal(await reloaded.read(actorB), undefined, 'another staff identity on this device reads nothing');
 assert.equal(await reloaded.read(otherCommittee), undefined, 'another committee reads nothing');
 await reloaded.close();
});

test('history cache: the Main Submitter country is cached with the resolution; entries cached before it existed still load', () => {
 const withCountry = historyContext([row('1')], [resolution], [delegate], []);
 assert.equal(withCountry.resolutions.r1.country, 'France');
 assert.equal(historyContext([row('1')], [resolution], [{ ...delegate, committeeId: 'sc', country: 'China' } as Delegate], []).resolutions.r1.country, undefined, 'another committee’s delegate is never cached');
 assert.equal(historyContext([row('1')], [resolution], [], []).resolutions.r1.country, undefined, 'no delegate on hand: no country');
 // An entry written before the country existed: title only. It is read as is, and a newer save keeps working without dropping a known country.
 const old = { key: 'k', rows: [row('1')], savedAt: now.toISOString(), context: { resolutions: { r1: { code: 'GA1 / 01', title: 'Safeguarding civilians' } }, delegations: {}, workingDocs: {} } };
 assert.equal(usableCache(old, now).context.resolutions.r1.country, undefined);
 const upgraded = mergeCache(old, 'k', 'ga1', [row('1')], withCountry, now);
 assert.equal(upgraded.context.resolutions.r1.country, 'France');
 const later = mergeCache(upgraded, 'k', 'ga1', [row('1')], historyContext([row('1')], [resolution], [], []), now);
 assert.equal(later.context.resolutions.r1.country, 'France', 'a save made without the delegate list keeps the country already known');
 assert.equal(later.context.resolutions.r1.title, 'Safeguarding civilians', 'the historical title is still stored');
});
