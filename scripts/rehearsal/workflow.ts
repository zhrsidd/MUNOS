import type { ConferenceData } from '../../lib/domain';
import type { SimUser } from './scenario';

/** Budget the actual scheduled submissions, including earlier stages that consume the same fixture's Drafts. */
export function draftRequirements(scenarios: SimUser[][], committees: number): number[] {
  const required = Array<number>(committees).fill(0);
  for (const scenario of scenarios) for (const user of scenario) {
    if (user.role === 'chair') required[user.committee] += user.steps.filter(s => s.action === 'sendToApproval').length;
  }
  return required;
}

/** Read-only admission before timed workload. Never reset a fixture or silently waive an unexercised operation. */
export function workflowPreflight(scenario: SimUser[], committees: { id: string; code: string }[], snapshots: ConferenceData[]) {
  const reasons: string[] = [];
  const required = draftRequirements([scenario], committees.length);
  const documents = [...new Map(snapshots.flatMap(d => d.documents).map(d => [d.id, d])).values()];
  for (const index of new Set(scenario.filter(u => u.role === 'chair').map(u => u.committee))) {
    const committee = committees[index];
    if (!committee || !snapshots.some(d => d.committees.some(c => c.id === committee.id))) {
      reasons.push(`${committee?.code ?? index}: no scoped fixture snapshot`); continue;
    }
    const drafts = documents.filter(d => d.committeeId === committee.id && d.status === 'Draft').length;
    if (drafts < required[index]) reasons.push(`${committee.code}: needs ${required[index]} Draft document(s), found ${drafts}`);
  }
  const scheduled = (action: string) => scenario.some(u => u.steps.some(s => s.action === action));
  if (scheduled('approve') && !documents.some(d => d.status === 'Submitted' || d.status === 'Review')) reasons.push('Approval: no Submitted or Review document');
  if (scheduled('print') && !documents.some(d => d.status === 'Approved')) reasons.push('Printing: no Approved document');
  return { pass: reasons.length === 0, reasons, draftsRequired: required };
}

interface PendingDevice {
  device: number; role: string; committee: string;
  pending: readonly { state: string; command: { type: string }; message?: string }[];
}
/** Non-secret evidence: never copy a command payload or raw server message into the public report. */
export function pendingDiagnostics(devices: PendingDevice[], limit = 100) {
  const cap = Math.max(0, Math.min(100, Math.trunc(limit) || 0));
  const items: { device: number; role: string; committee: string; command: string; state: string; reason?: string }[] = [];
  let total = 0;
  for (const d of devices) for (const m of d.pending) {
    total++;
    if (items.length >= cap) continue;
    const state = m.state === 'conflict' ? 'conflict' : 'pending';
    const message = m.message ?? '';
    const reason = /changed|revision|stale/i.test(message) ? 'revision_changed'
      : /access|permission|identity/i.test(message) ? 'access_changed'
      : /missing|unavailable|first|finished/i.test(message) ? 'missing_dependency' : 'needs_review';
    items.push({ device: d.device, role: d.role, committee: d.committee, command: m.command.type, state,
      ...(state === 'conflict' ? { reason } : {}) });
  }
  return { total, items, truncated: total - items.length };
}
