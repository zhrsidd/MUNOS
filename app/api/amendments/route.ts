import { amendmentBackend } from '@/lib/amendments/backend';
import { amendmentMessages } from '@/lib/amendments/rules';
import { handleAmendment } from '@/lib/amendments/service';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
// Bounded streaming read also protects requests without a Content-Length header.
export async function POST(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ ok: false, error: 'invalid_amendment', message: amendmentMessages.invalid_amendment }, { status: 400, headers });
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32_768) { await reader.cancel(); return Response.json({ ok: false, error: 'invalid_amendment', message: amendmentMessages.invalid_amendment }, { status: 413, headers }); }
      parts.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    const input: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const { status, body } = await handleAmendment(input, amendmentBackend());
    return Response.json(body, { status, headers });
  } catch { return Response.json({ ok: false, error: 'invalid_amendment', message: amendmentMessages.invalid_amendment }, { status: 400, headers }); }
  finally { reader.releaseLock(); }
}
