export const AMENDMENT_TOKEN = /^[A-Za-z0-9_-]{22,64}$/;
export const AMENDMENT_TYPES = ['Add', 'Strike', 'Replace'] as const;
export type AmendmentType = typeof AMENDMENT_TYPES[number];
export const MAX_CLAUSE = 200;
export const MAX_WORDING = 4000;
export interface AmendmentLinkInfo {
  committee: { id: string; code: string; name: string };
  resolution: { id: string; code: string; title: string } | null;
  delegates: { id: string; country: string }[];
}
export type AmendmentError = 'invalid_link' | 'invalid_submitter' | 'not_open' | 'invalid_amendment' | 'rate_limited' | 'idempotency_conflict' | 'not_configured' | 'server_error';
export const amendmentMessages: Record<AmendmentError, string> = {
  invalid_link: 'This amendment link is invalid or has been replaced. Scan the current QR code in your committee room.',
  invalid_submitter: 'Choose your delegation from this committee.',
  not_open: 'Amendments are not currently open in this committee. Reload the form to check the current resolution.',
  invalid_amendment: 'Choose an amendment type, enter a clause/reference (1–200 characters) and exact wording (1–4,000 characters), then confirm the wording.',
  rate_limited: 'Too many amendments were submitted recently. Wait a few minutes and retry with the same details.',
  idempotency_conflict: 'This reference was already used for different details. Ask your Chair to check the original before sending another amendment.',
  not_configured: 'Online amendments are not available right now. Your amendment has not been submitted. Ask your Chair.',
  server_error: 'We could not confirm whether your amendment was received. Retry with the same details and reference; this will not create a second amendment.',
};
export type AmendmentResponse = { ok: true; status: 'created' | 'replayed' | 'duplicate'; id: string } | { ok: false; error: AmendmentError; message: string };
