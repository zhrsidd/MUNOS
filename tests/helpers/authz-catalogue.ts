import type {ConfRole, Fixture, Scope} from './authz-fixture';

/**
 * Every write command the three routers dispatch, with the role rules DERIVED FROM DOCUMENTED INTENT, not from the
 * SQL under test: AGENTS.md ("Chair, Approval Panel, printing and Executive permissions stay separate"),
 * lib/operations/commands.ts `operationsRoles`, the Chair/Executive split in docs/OPERATIONS.md and lib/access.ts
 * (chair = committee scoped; approval, logistics ("Admins") and admin ("Executive") = conference wide).
 *  - `roles`  the roles intended to perform the command
 *  - `scope`  the committee the command acts on (null: conference-wide, so a committee-scoped grant must not reach it)
 *  - `wrongRoleCode`  how a correctly granted but unintended role is refused (document transitions are refused as
 *    22023 "Transition not allowed for this role", everything else as 42501)
 */
export interface Cmd {
 /** Unique cell-group name. */
 id: string;
 /** Command `type` (the key the coverage test compares with the SQL dispatch). */
 type: string;
 router: 'conference' | 'operations';
 impl: 'mutation' | 'procedure' | 'batch' | 'operations';
 command: (f: Fixture) => Record<string, unknown>;
 roles: ConfRole[];
 scope: Scope;
 /** Owner SQL run before the call so the command is otherwise valid. */
 pre?: (f: Fixture) => string;
 /** Owner SQL expression for the optimistic precondition the server compares. Absent: the command takes none. */
 expected?: (f: Fixture) => string;
 wrongRoleCode?: '42501' | '22023';
 /** The command is deliberately retired: even the intended role is refused with 22023. */
 retired?: boolean;
 /** Also run for the revoked/expired grant actors. */
 representative?: boolean;
}

const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
const U = (n: number) => `7d000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const Q1 = U(1), SPEECH = U(2), POI = U(3), AMENDMENT = U(4);
const rev = (table: string, id: string, column = 'revision') => `(select ${column}::text from public.${table} where id=${q(id)})`;

const queueRow = (f: Fixture) => `delete from public.speaker_queue where "sessionId"=${q(f.session)};
 insert into public.speaker_queue(id,conference_id,committee_id,"delegateId","sessionId",position,lane) values (${q(Q1)},${q(f.confA)},${q(f.committee.ga1)},${q(f.japan)},${q(f.session)},0,'open');`;
const speechRow = (f: Fixture, state: 'speaking' | 'pois', classification: string, delegate: string, resolution: string | null, extra = '') =>
 `insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,state${extra ? ',"poiLimit"' : ''})
  values (${q(SPEECH)},${q(f.confA)},${q(f.committee.ga1)},${q(f.session)},${q(delegate)},${resolution ? q(resolution) : 'null'},${q(classification)},${q(state)}${extra ? ',2' : ''});`;
const poiRow = (f: Fixture, recognized: boolean) =>
 `insert into public.poi_queue(id,conference_id,committee_id,"speechId","delegateId",position,"recognizedAt") values (${q(POI)},${q(f.confA)},${q(f.committee.ga1)},${q(SPEECH)},${q(f.france)},0,${recognized ? 'now()' : 'null'});`;
const speechRev = rev('speeches', SPEECH);

const chair = ['chair'] as ConfRole[];
const admin = ['admin'] as ConfRole[];

export const COMMANDS: Cmd[] = [
 // ---- private.apply_mutation (via public.apply_conference_mutation) ----
 {id: 'attendance', type: 'attendance', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1', representative: true,
  command: f => ({type: 'attendance', delegateId: f.japan, sessionId: f.session, status: 'Absent'}),
  expected: f => `(select revision::text from public.attendance where "sessionId"=${q(f.session)} and "delegateId"=${q(f.japan)})`},
 {id: 'participation', type: 'participation', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'participation', delegateId: f.france, sessionId: f.session, categoryId: 'speech', points: 2, resolutionId: null})},
 {id: 'event', type: 'event', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'event', id: f.participationEvent, points: 2}),
  expected: f => `(select count(*)::text from public.participation_corrections where event_id=${q(f.participationEvent)})`},
 {id: 'queue', type: 'queue', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'queue', delegateId: f.japan, sessionId: f.session})},
 {id: 'timer', type: 'timer', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'timer', sessionId: f.session, duration: 90, remaining: 60, startedAt: null}),
  expected: f => `coalesce((select revision::text from public.timers where "sessionId"=${q(f.session)}),'0')`},
 {id: 'vote', type: 'vote', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'vote', delegateId: f.france, sessionId: f.session, resolutionId: f.resolution, choice: 'For'}),
  expected: f => `coalesce((select revision::text from public.votes where "sessionId"=${q(f.session)} and "delegateId"=${q(f.france)} and "resolutionId"=${q(f.resolution)}),'0')`},
 // The four document transitions are separate rules: the Chair submits/opens/closes, the Approval Panel reviews,
 // Logistics prints. A role that holds a valid grant but not this transition is refused as 22023.
 {id: 'document:chairSubmit', type: 'document', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1', wrongRoleCode: '22023', representative: true,
  command: f => ({type: 'document', id: f.docDraft, status: 'Submitted'}), expected: f => rev('documents', f.docDraft)},
 {id: 'document:chairWithdraw', type: 'document', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1', wrongRoleCode: '22023',
  command: f => ({type: 'document', id: f.resolution, status: 'Closed', outcome: 'Withdrawn'}), expected: f => rev('documents', f.resolution)},
 {id: 'document:chairDebate', type: 'document', router: 'conference', impl: 'mutation', roles: chair, scope: 'who', wrongRoleCode: '22023',
  pre: f => `update public.documents set status='Printed' where id=${q(f.docApproved)}; update public.committees set "currentSessionId"=${q(f.sessionWho)} where id=${q(f.committee.who)};`,
  command: f => ({type: 'document', id: f.docApproved, status: 'In Debate'}), expected: f => rev('documents', f.docApproved)},
 {id: 'document:approvalReview', type: 'document', router: 'conference', impl: 'mutation', roles: ['approval'], scope: 'ga1', wrongRoleCode: '22023', representative: true,
  command: f => ({type: 'document', id: f.docReview, status: 'Approved'}), expected: f => rev('documents', f.docReview)},
 {id: 'document:logisticsPrint', type: 'document', router: 'conference', impl: 'mutation', roles: ['logistics'], scope: 'who', wrongRoleCode: '22023', representative: true,
  command: f => ({type: 'document', id: f.docApproved, status: 'Printed'}), expected: f => rev('documents', f.docApproved)},
 {id: 'version', type: 'version', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'version', id: f.docDraft, fileName: 'v2.txt', text: 'Second draft'}), expected: f => rev('documents', f.docDraft)},
 {id: 'newDocument', type: 'newDocument', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1',
  command: f => ({type: 'newDocument', committeeId: f.committee.ga1, sessionId: f.session, title: 'Fixture resolution', submitterId: f.france})},
 {id: 'award', type: 'award', router: 'conference', impl: 'mutation', roles: chair, scope: 'ga1', retired: true,
  command: f => ({type: 'award', delegateId: f.france, criterionId: U(9), score: 1, notes: ''})},
 {id: 'committee', type: 'committee', router: 'conference', impl: 'mutation', roles: admin, scope: null, representative: true,
  command: () => ({type: 'committee', code: 'NEWC', name: 'New committee', room: 'R9'})},
 {id: 'session', type: 'session', router: 'conference', impl: 'mutation', roles: admin, scope: 'ga1',
  command: f => ({type: 'session', committeeId: f.committee.ga1, name: 'Extra session'})},
 {id: 'school', type: 'school', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: () => ({type: 'school', name: 'Fixture school'})},
 {id: 'delegate', type: 'delegate', router: 'conference', impl: 'mutation', roles: admin, scope: 'ga1',
  command: f => ({type: 'delegate', id: f.france, name: 'Renamed Delegate', email: 'renamed@example.com', country: 'France'})},
 {id: 'import', type: 'import', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: f => ({type: 'import', rows: [{name: 'Imported', country: 'Chile', email: 'imported@example.com', schoolId: f.schoolA, committeeId: f.committee.ga1}]})},
 {id: 'conference', type: 'conference', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: () => ({type: 'conference', name: 'Renamed conference', venue: 'Venue', date: '2026-11-05'})},
 {id: 'feature', type: 'feature', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: () => ({type: 'feature', name: 'Print queue', enabled: true})},
 {id: 'scoring', type: 'scoring', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: () => ({type: 'scoring', id: 'speech', values: [1, 2, 3]})},
 {id: 'criterion', type: 'criterion', router: 'conference', impl: 'mutation', roles: admin, scope: null, retired: true,
  command: () => ({type: 'criterion', id: U(9), name: 'Rubric', description: 'x', max: 5})},
 {id: 'staffContact', type: 'staffContact', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: f => ({type: 'staffContact', id: f.chairStaff, email: 'chair@example.com'}), expected: f => rev('staff', f.chairStaff, '"contactRevision"')},
 {id: 'staff', type: 'staff', router: 'conference', impl: 'mutation', roles: admin, scope: null,
  command: f => ({type: 'staff', name: 'Newcomer', role: 'chair', committeeIds: [f.committee.ga1]})},

 // ---- private.apply_procedure ----
 {id: 'currentSession', type: 'currentSession', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1', representative: true,
  command: f => ({type: 'currentSession', committeeId: f.committee.ga1, sessionId: f.session}), expected: f => rev('committees', f.committee.ga1, '"sessionRevision"')},
 {id: 'debateMode', type: 'debateMode', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  command: f => ({type: 'debateMode', sessionId: f.session, mode: 'open', phase: 'for'}),
  expected: f => `coalesce((select revision::text from public.debate_states where "sessionId"=${q(f.session)}),'0')`},
 {id: 'queueAdd', type: 'queueAdd', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  command: f => ({type: 'queueAdd', sessionId: f.session, delegateId: f.japan, lane: 'open'})},
 {id: 'queueOrder', type: 'queueOrder', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1', pre: queueRow,
  command: f => ({type: 'queueOrder', sessionId: f.session, lane: 'open', ids: [Q1]}), expected: () => `${q(Q1)}`},
 {id: 'queueRemove', type: 'queueRemove', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1', pre: queueRow,
  command: f => ({type: 'queueRemove', sessionId: f.session, entryId: Q1})},
 {id: 'speechStart', type: 'speechStart', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  command: f => ({type: 'speechStart', sessionId: f.session, delegateId: f.france, resolutionId: f.resolution, classification: 'Main Submitter'}),
  expected: f => `coalesce((select id::text from public.speeches where "sessionId"=${q(f.session)} and state<>'finished'),'empty')`},
 {id: 'speechYield', type: 'speechYield', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'speaking', 'Main Submitter', f.france, f.resolution),
  command: f => ({type: 'speechYield', sessionId: f.session, speechId: SPEECH, delegateId: f.japan}), expected: () => speechRev},
 {id: 'speechScore', type: 'speechScore', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'speaking', 'Other', f.japan, null),
  command: f => ({type: 'speechScore', sessionId: f.session, speechId: SPEECH, points: 2}), expected: () => speechRev},
 {id: 'speechFinish', type: 'speechFinish', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'speaking', 'Other', f.japan, null),
  command: f => ({type: 'speechFinish', sessionId: f.session, speechId: SPEECH}), expected: () => speechRev},
 {id: 'poiAllowance', type: 'poiAllowance', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'speaking', 'Other', f.japan, null),
  command: f => ({type: 'poiAllowance', sessionId: f.session, speechId: SPEECH, limit: 2}), expected: () => speechRev},
 {id: 'poiAdd', type: 'poiAdd', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'pois', 'Other', f.japan, null, 'limit'),
  command: f => ({type: 'poiAdd', sessionId: f.session, speechId: SPEECH, delegateId: f.france})},
 {id: 'poiOrder', type: 'poiOrder', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'pois', 'Other', f.japan, null, 'limit') + poiRow(f, false),
  command: f => ({type: 'poiOrder', sessionId: f.session, speechId: SPEECH, ids: [POI]}), expected: () => q(POI)},
 {id: 'poiRecognize', type: 'poiRecognize', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'pois', 'Other', f.japan, null, 'limit') + poiRow(f, false),
  command: f => ({type: 'poiRecognize', sessionId: f.session, speechId: SPEECH, entryId: POI}), expected: () => speechRev},
 {id: 'poiScore', type: 'poiScore', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'pois', 'Other', f.japan, null, 'limit') + poiRow(f, true),
  command: f => ({type: 'poiScore', sessionId: f.session, speechId: SPEECH, entryId: POI, points: 2}), expected: () => speechRev},
 {id: 'poiRemove', type: 'poiRemove', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  pre: f => speechRow(f, 'pois', 'Other', f.japan, null, 'limit') + poiRow(f, false),
  command: f => ({type: 'poiRemove', sessionId: f.session, speechId: SPEECH, entryId: POI}), expected: () => speechRev},
 {id: 'voteMode', type: 'voteMode', router: 'conference', impl: 'procedure', roles: chair, scope: 'ga1',
  command: f => ({type: 'voteMode', sessionId: f.session, resolutionId: f.resolution, mode: 'normal', voteType: 'substantive'}), expected: f => rev('documents', f.resolution)},
 {id: 'vetoRules', type: 'vetoRules', router: 'conference', impl: 'procedure', roles: admin, scope: 'ga1',
  command: f => ({type: 'vetoRules', committeeId: f.committee.ga1, enabled: true, delegateIds: [f.france]})},

 // ---- private.apply_staff_batch ----
 {id: 'committeeUpdate', type: 'committeeUpdate', router: 'conference', impl: 'batch', roles: admin, scope: 'ga1', representative: true,
  command: f => ({type: 'committeeUpdate', id: f.committee.ga1, code: 'GA1', name: 'Renamed assembly', room: 'Room 204'}), expected: f => rev('committees', f.committee.ga1)},
 {id: 'committeeLifecycle', type: 'committeeLifecycle', router: 'conference', impl: 'batch', roles: admin, scope: 'sc',
  command: f => ({type: 'committeeLifecycle', id: f.committee.sc, action: 'archive'}), expected: f => rev('committees', f.committee.sc)},
 {id: 'sessionSlot', type: 'sessionSlot', router: 'conference', impl: 'batch', roles: admin, scope: null,
  command: () => ({type: 'sessionSlot', action: 'create', name: 'Central slot', startsAt: '2026-11-06T06:00:00Z', endsAt: '2026-11-06T09:00:00Z'})},
 {id: 'amendmentLink', type: 'amendmentLink', router: 'conference', impl: 'batch', roles: admin, scope: 'ga1',
  command: f => ({type: 'amendmentLink', action: 'rotate', committeeId: f.committee.ga1, token: 'amend_rotated_token_dddddddd'}), expected: f => `${q(f.amendmentLink)}`},
 {id: 'amendmentStatus', type: 'amendmentStatus', router: 'conference', impl: 'batch', roles: chair, scope: 'ga1',
  pre: f => `insert into public.amendments(id,conference_id,committee_id,"resolutionId","sessionId","submitterId",type,clause,wording) values (${q(AMENDMENT)},${q(f.confA)},${q(f.committee.ga1)},${q(f.resolution)},${q(f.session)},${q(f.france)},'Add','1','Wording');`,
  command: () => ({type: 'amendmentStatus', id: AMENDMENT, status: 'Accepted for Debate'}), expected: () => rev('amendments', AMENDMENT)},

 // ---- private.apply_operations_mutation (via public.apply_operations_mutation) ----
 {id: 'submissionLink', type: 'submissionLink', router: 'operations', impl: 'operations', roles: admin, scope: 'ga1', representative: true,
  command: f => ({type: 'submissionLink', action: 'rotate', committeeId: f.committee.ga1, token: 'sub_rotated_token_eeeeeeeeeee'}),
  expected: f => `(select id::text||'|'||share_with from public.submission_links where committee_id=${q(f.committee.ga1)} and revoked_at is null)`},
 {id: 'resolutionLink', type: 'resolutionLink', router: 'operations', impl: 'operations', roles: ['chair', 'admin'], scope: 'ga1', representative: true,
  command: f => ({type: 'resolutionLink', documentId: f.resolution, action: 'access', access: 'ok'}),
  expected: f => `coalesce((select revision::text from public.resolution_links where document_id=${q(f.resolution)}),'0')`},
 {id: 'sessionImport', type: 'sessionImport', router: 'operations', impl: 'operations', roles: admin, scope: null,
  command: f => ({type: 'sessionImport', rows: [{committeeId: f.committee.ga1, name: 'Imported session', startsAt: '2026-11-09T09:00:00Z', endsAt: null}]})},
 {id: 'photoSlot:create', type: 'photoSlot', router: 'operations', impl: 'operations', roles: admin, scope: null,
  command: f => ({type: 'photoSlot', action: 'create', schoolId: f.schoolA, startsAt: '2026-11-07T10:00:00Z', endsAt: null, location: 'Hall', note: ''})},
 {id: 'photoSlot:update', type: 'photoSlot', router: 'operations', impl: 'operations', roles: admin, scope: null,
  command: f => ({type: 'photoSlot', action: 'update', slotId: f.photoSlot, schoolId: f.schoolA, startsAt: '2026-11-07T11:00:00Z', endsAt: null, location: 'Hall 2', note: ''}),
  expected: f => rev('photo_slots', f.photoSlot)},
 {id: 'photoImport', type: 'photoImport', router: 'operations', impl: 'operations', roles: admin, scope: null,
  command: f => ({type: 'photoImport', rows: [{schoolId: f.schoolA, startsAt: '2026-11-08T10:00:00Z', endsAt: null, location: 'Hall', note: ''}]})},
 {id: 'photoAck', type: 'photoAck', router: 'operations', impl: 'operations', roles: chair, scope: 'ga1',
  command: f => ({type: 'photoAck', committeeId: f.committee.ga1, slotId: f.photoSlot, stage: 'warning', revision: 1, epoch: 0, chairs: ''})},
 {id: 'staffSchool', type: 'staffSchool', router: 'operations', impl: 'operations', roles: admin, scope: null,
  command: f => ({type: 'staffSchool', staffId: f.chairStaff, schoolId: f.schoolA}),
  expected: f => `coalesce((select "schoolId"::text from public.staff where id=${q(f.chairStaff)}),'none')`},
 {id: 'pointAdjustment', type: 'pointAdjustment', router: 'operations', impl: 'operations', roles: chair, scope: 'ga1', representative: true,
  command: f => ({type: 'pointAdjustment', action: 'deduct', delegateId: f.france, sessionId: f.session, amount: 2, reason: 'Disrupted the session'})},
];
