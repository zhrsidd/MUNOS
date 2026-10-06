// Prints the human-paced rehearsal scenario WITHOUT any network access.
//   npm run rehearsal:plan -- --staff 50 --delegates 150 --minutes 10 [--committees 14] [--start-window 150]
//                             [--delegate-window 120] [--submit-fraction 0.3]
// Staff = Chairs, Approval, Admins, Executive (Conference OS users). Delegates = public QR form only.
import { checkUsers } from "./rehearsal/guard";
import { buildScenario, HUMAN_FLOOR_SECONDS, summarize } from "./rehearsal/scenario";
const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : fallback; };
const staff = num("--staff", 50), delegates = num("--delegates", 0), minutes = num("--minutes", 10);
for (const [label, n] of [["staff", staff], ["delegates", delegates]] as const) {
  const guard = checkUsers(n === 0 && label === "delegates" ? 1 : n);
  if (!guard.ok) { console.error(`${label}: ${guard.reason}`); process.exit(2); }
}
const scenario = buildScenario({ staff, delegates, minutes, committees: num("--committees", 14), startWindowSeconds: num("--start-window", 150), delegateWindowSeconds: num("--delegate-window", 120), submitFraction: num("--submit-fraction", 0.3) });
console.log(JSON.stringify({ dryRun: true, staff, delegates, minutes, humanFloorSeconds: HUMAN_FLOOR_SECONDS, ...summarize(scenario, minutes) }, null, 2));
