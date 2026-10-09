// Prints the human-paced rehearsal scenario WITHOUT any network access.
//   npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10 [--committees 14] [--start-window 150]
//                             [--delegate-window 120] [--submit-fraction 0.3]
//                             [--read-ms 600,7000] [--send-ms 300] [--realtime topic-aware|current|both]
//                             [--executive-chair-window 0,2000]
// Staff = Chairs, Approval, Admins, Executive (Conference OS users). Delegates = public QR form only.
// The refresh estimate runs the same one-in-flight client model as the live harness on a virtual clock, at each
// assumed full-refresh latency (refresh counts depend on latency because triggers that arrive mid-flush are dropped).
import { checkUsers } from "./rehearsal/guard";
import { estimate } from "./rehearsal/estimate";
import { buildScenario, HUMAN_FLOOR_SECONDS, summarize, type RealtimeModel } from "./rehearsal/scenario";
const args = process.argv.slice(2);
const raw = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const num = (flag: string, fallback: number) => Number(raw(flag) ?? fallback);
const staff = num("--staff", 50), delegates = num("--delegates", 0), minutes = num("--minutes", 10);
for (const [label, n] of [["staff", staff], ["delegates", delegates]] as const) {
  const guard = checkUsers(n === 0 && label === "delegates" ? 1 : n);
  if (!guard.ok) { console.error(`${label}: ${guard.reason}`); process.exit(2); }
}
const scenario = buildScenario({ staff, delegates, minutes, committees: num("--committees", 14), startWindowSeconds: num("--start-window", 150), delegateWindowSeconds: num("--delegate-window", 120), submitFraction: num("--submit-fraction", 0.3) });
const models: RealtimeModel[] = (raw("--realtime") ?? "both") === "both" ? ["current", "topic-aware"] : [raw("--realtime") as RealtimeModel];
const estimates = [];
for (const readMs of (raw("--read-ms") ?? "600,7000").split(",").map(Number))
  for (const model of models)
    for (const executiveChairWindowMs of model === "topic-aware" ? (raw("--executive-chair-window") ?? "0,2000").split(",").map(Number) : [0])
      estimates.push(await estimate(scenario, { minutes, readMs, sendMs: num("--send-ms", 300), model, executiveChairWindowMs }));
console.log(JSON.stringify({ dryRun: true, staff, delegates, minutes, humanFloorSeconds: HUMAN_FLOOR_SECONDS, ...summarize(scenario, minutes), clientModelEstimates: estimates }, null, 2));
