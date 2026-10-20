import { amendmentBackend } from '@/lib/amendments/backend';
import { amendmentMessages } from '@/lib/amendments/rules';
import { handleAmendment } from '@/lib/amendments/service';
import { readBoundedBody } from '@/lib/http/bounded-body';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
const MAX_AMENDMENT_BODY = 32_768;
// Bounded streaming read also protects requests without a Content-Length header.
export async function POST(request: Request) {
  const invalid = (status: number) => Response.json({ ok: false, error: 'invalid_amendment', message: amendmentMessages.invalid_amendment }, { status, headers });
  const body = await readBoundedBody(request, MAX_AMENDMENT_BODY);
  if (!body.ok) return invalid(body.reason === 'too_large' ? 413 : 400);
  try {
    const input: unknown = JSON.parse(new TextDecoder().decode(body.bytes));
    const { status, body: result } = await handleAmendment(input, amendmentBackend());
    return Response.json(result, { status, headers });
  } catch { return invalid(400); }
}
