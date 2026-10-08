import { AMENDMENT_TOKEN, AMENDMENT_TYPES, MAX_CLAUSE, MAX_WORDING, amendmentMessages, type AmendmentError, type AmendmentLinkInfo, type AmendmentResponse, type AmendmentType } from './rules';
export interface AmendmentSubmitArgs { token: string; submissionId: string; submitterId: string; resolutionId: string; type: AmendmentType; clause: string; wording: string }
export class AmendmentRejected extends Error { constructor(public reason: AmendmentError) { super(reason); } }
export interface AmendmentBackend {
  linkInfo(token: string): Promise<AmendmentLinkInfo | null>;
  submit(args: AmendmentSubmitArgs): Promise<{ status: 'created' | 'replayed' | 'duplicate'; id: string }>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (status: number, error: AmendmentError) => ({ status, body: { ok: false, error, message: amendmentMessages[error] } as AmendmentResponse });
/** This validates the HTTP boundary; the transactional RPC revalidates link, scope, current resolution and limits. */
export async function handleAmendment(input: unknown, backend: AmendmentBackend | null): Promise<{ status: number; body: AmendmentResponse }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'invalid_amendment');
  const body = input as Record<string, unknown>;
  if (typeof body.token !== 'string' || !AMENDMENT_TOKEN.test(body.token)) return fail(404, 'invalid_link');
  if (!backend) return fail(503, 'not_configured');
  if (typeof body.submissionId !== 'string' || !UUID.test(body.submissionId) || typeof body.resolutionId !== 'string' || !UUID.test(body.resolutionId)) return fail(400, 'invalid_amendment');
  if (typeof body.submitterId !== 'string' || !UUID.test(body.submitterId)) return fail(400, 'invalid_submitter');
  if (!AMENDMENT_TYPES.includes(body.type as AmendmentType) || typeof body.clause !== 'string' || typeof body.wording !== 'string' || body.confirmed !== true) return fail(400, 'invalid_amendment');
  const clause = body.clause.trim(), wording = body.wording.trim();
  if (!clause.length || clause.length > MAX_CLAUSE || !wording.length || wording.length > MAX_WORDING) return fail(400, 'invalid_amendment');
  try {
    // Delegate/resolution validation stays inside submit(), so retries of an accepted submission
    // can return the receipt even after debate has moved on. Never pre-check a stale page snapshot.
    const result = await backend.submit({ token: body.token, submissionId: body.submissionId, submitterId: body.submitterId, resolutionId: body.resolutionId, type: body.type as AmendmentType, clause, wording });
    return { status: result.status === 'created' ? 201 : 200, body: { ok: true, ...result } };
  } catch (error) {
    if (error instanceof AmendmentRejected) return fail(error.reason === 'invalid_link' ? 404 : error.reason === 'rate_limited' ? 429 : error.reason === 'not_open' || error.reason === 'idempotency_conflict' ? 409 : 400, error.reason);
    return fail(503, 'server_error');
  }
}
