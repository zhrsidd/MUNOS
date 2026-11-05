#!/usr/bin/env node
// Creates a macOS LaunchAgent. PREPARE DOES NOT START MONITORING.
import { mkdir, writeFile, access, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

if (process.platform !== "darwin") {
  console.error("This launcher is for macOS only."); process.exit(1);
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = join(repo, "scripts", "jarvis", "monitor.mjs");
const env = resolve(process.env.JARVIS_ENV_FILE || join(repo, ".env.local"));
const label = "com.dcmun.jarvis.monitor";
const plist = join(homedir(), "Library", "LaunchAgents", label + ".plist");
const logdir = join(homedir(), ".local", "state", "dcmun-jarvis");
const command = process.argv[2] || "--help";
const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function launchctl(...args) {
  const result = spawnSync("launchctl", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error("launchctl failed with status " + result.status);
}
async function prepare() {
  await access(env); // Must exist; never expose its contents.
  await mkdir(dirname(plist), { recursive: true });
  await mkdir(logdir, { recursive: true, mode: 0o700 });
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${xml(label)}</string>
<key>ProgramArguments</key><array>
<string>${xml(process.execPath)}</string>
<string>--env-file=${xml(env)}</string>
<string>${xml(script)}</string>
<string>--once</string>
</array>
<key>WorkingDirectory</key><string>${xml(repo)}</string>
<key>StartInterval</key><integer>120</integer>
<key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(join(logdir, "monitor.stdout.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(logdir, "monitor.stderr.log"))}</string>
</dict></plist>
`;
  await writeFile(plist, body, { mode: 0o600 });
  console.log("LaunchAgent prepared, NOT started:", plist);
}
try {
  if (command === "--prepare") {
    await prepare();
  } else if (command === "--start") {
    await access(plist);
    launchctl("bootstrap", "gui/" + process.getuid(), plist);
    console.log("LaunchAgent started. Monitoring polls every 120 seconds.");
  } else if (command === "--stop") {
    launchctl("bootout", "gui/" + process.getuid() + "/" + label);
    console.log("LaunchAgent stopped.");
  } else if (command === "--remove") {
    await rm(plist, { force: true });
    console.log("Removed LaunchAgent file. Stop the service first if it is running.");
  } else {
    console.log("Usage: install-launchd.mjs --prepare | --start | --stop | --remove");
  }
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
