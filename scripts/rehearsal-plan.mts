// Prints the human-paced rehearsal scenario WITHOUT any network access.
//   npm run rehearsal:plan -- --users 100 --minutes 10 [--committees 12] [--start-window 150] [--submit-fraction 0.1]
import { checkUsers } from "./rehearsal/guard";
import { buildScenario, HUMAN_FLOOR_SECONDS, summarize } from "./rehearsal/scenario";
const args = process.argv.slice(2);
const num = (flag: string, fallback: number) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : fallback; };
const users = num("--users", 100), minutes = num("--minutes", 10);
const guard = checkUsers(users);
if (!guard.ok) { console.error(guard.reason); process.exit(2); }
const scenario = buildScenario({ users, minutes, committees: num("--committees", 12), startWindowSeconds: num("--start-window", 150), submitFraction: num("--submit-fraction", 0.1) });
console.log(JSON.stringify({ dryRun: true, users, minutes, humanFloorSeconds: HUMAN_FLOOR_SECONDS, ...summarize(scenario, minutes) }, null, 2));
