// Dry-run Drive folder planner. NO Google API calls, NO credentials, NO database access.
//   npm run drive:plan -- --conference "DCMUN XVIII" --committees "GA1,GA2,WHO,SC"
//   npm run drive:plan -- --conference "DCMUN XVIII" --committees-file committees.txt [--json] [--explain]
// committees.txt: one committee per line, "GA1 | General Assembly First Committee".
import { readFile } from "node:fs/promises";
import { flatten, parseCommitteeList, planDrive, renderTree } from "../lib/drive/plan";
import { createSeed } from "../lib/seed";
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const conference = value("--conference") ?? "DCMUN (example)";
const file = value("--committees-file");
const list = value("--committees");
const committees = file ? parseCommitteeList(await readFile(file, "utf8")) : list ? parseCommitteeList(list) : createSeed().committees.map((c) => ({ code: c.code, name: c.name }));
try {
  const plan = planDrive(conference, committees);
  if (args.includes("--json")) console.log(JSON.stringify({ dryRun: true, folders: flatten(plan) }, null, 2));
  else {
    console.log(renderTree(plan, args.includes("--explain")));
    console.log(`\n${flatten(plan).length} folders · dry run only: nothing was created and Google was not contacted.`);
    if (!file && !list) console.log("(Example committees from the demo data. Pass --committees or --committees-file.)");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
