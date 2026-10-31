// Prints the human-paced rehearsal scenario WITHOUT any network access.
//   npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10 [--committees 14] [--start-window 150]
//                             [--delegate-window 120] [--submit-fraction 0.3]
//                             [--read-ms 600,7000] [--send-ms 300] [--realtime topic-aware|current|both]
//                             [--executive-chair-window 0,2000]
// Staff = Chairs, Approval, Admins, Executive (Conference OS users). Delegates = public QR form only.
// The refresh estimate preserves a HISTORICAL comparison model; it is not a current live-run prediction.
// The scenario still prints configured populations/public submissions for local preflight.
import { checkUsers } from "./rehearsal/guard";
import { estimate } from "./rehearsal/estimate";
import { buildScenario, HUMAN_FLOOR_SECONDS, parseStaffProfile, summarize, type RealtimeModel } from "./rehearsal/scenario";
import { draftRequirements } from './rehearsal/workflow';
const args = process.argv.slice(2);
const raw = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const num = (flag: string, fallback: number) => Number(raw(flag) ?? fallback);
const staffProfile = parseStaffProfile(args.includes('--staff-profile') ? raw('--staff-profile') ?? '' : undefined);
const staff = num("--staff", 50), delegates = num("--delegates", 0), minutes = num("--minutes", 10);
for (const [label, n] of [["staff", staff], ["delegates", delegates]] as const) {
  const guard = checkUsers(n === 0 && label === "delegates" ? 1 : n);
  if (!guard.ok) { console.error(`${label}: ${guard.reason}`); process.exit(2); }
}
const options = { staff, staffProfile, delegates, minutes, committees: num("--committees", 14), startWindowSeconds: num("--start-window", 150), delegateWindowSeconds: num("--delegate-window", 120), submitFraction: num("--submit-fraction", 0.3) };
const scenario = buildScenario(options);
const draftStages = (raw('--draft-stages') ?? String(staff)).split(',').map(Number);
if (draftStages.some(n => !checkUsers(n).ok)) throw Error('--draft-stages must contain valid staff counts.');
const draftsRequired = draftRequirements(draftStages.map(n => buildScenario({ ...options, staff: n })), options.committees);
const models: RealtimeModel[] = (raw("--realtime") ?? "both") === "both" ? ["current", "topic-aware"] : [raw("--realtime") as RealtimeModel];
const estimates = [];
for (const readMs of (raw("--read-ms") ?? "600,7000").split(",").map(Number))
  for (const model of models)
    for (const executiveChairWindowMs of model === "topic-aware" ? (raw("--executive-chair-window") ?? "0,2000").split(",").map(Number) : [0])
      estimates.push(await estimate(scenario, { minutes, readMs, sendMs: num("--send-ms", 300), model, executiveChairWindowMs }));
console.log(JSON.stringify({ dryRun: true, modelStatus: "HISTORICAL COMPARISON ONLY; no current H3 rate prediction. Live runner uses actual DurableRepository.", staff, staffProfile, delegates, minutes, humanFloorSeconds: HUMAN_FLOOR_SECONDS, ...summarize(scenario, minutes), draftBudget: { stages: draftStages, requiredByCommittee: draftsRequired, draftsPerCommittee: Math.max(1, ...draftsRequired) }, clientModelEstimates: estimates }, null, 2));
