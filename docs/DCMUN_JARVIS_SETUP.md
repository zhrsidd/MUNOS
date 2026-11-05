# DCMUN JARVIS: emergency-only local monitor

**Prepared only. Nothing in this branch runs automatically, no production schema changes are made,
and phone calls are impossible until you explicitly arm the monitor.** This is intentionally
isolated from the Next.js app and Vercel.

## What this actually does

- A macOS LaunchAgent invokes a read-only Node.js script every 120 seconds.
- It counts delegates and committees from DCMUN Production and verifies that the expected
  conference is present. Optionally, it checks a production app URL over HTTPS.
- It calls neither Claude nor ElevenLabs for normal checks. Claude Pro tokens are not
  needed to run the monitor.
- It creates a local incident report in `~/.local/state/dcmun-jarvis/latest.md`
  **before** requesting a one-way urgent Silyring call.
- It calls only after three consecutive database or site failures, two consecutive
  missing-conference checks, or two substantial population drops.
- It makes at most 6 attempted calls in a rolling 24-hour period and 12 total per
  monitor state, with a 30-minute per-incident cooldown. Failed/ambiguous requests
  count toward the budget and are not blindly retried.
- No delegate names, emails, credentials, audit details, or IDs go into phone calls.
  The state directory is private to the Mac user.

### Important limits

This is an **exception detector**, not a continuously thinking Claude process.
The current rules do not reliably identify individual offline devices, unsynced
IndexedDB outboxes, failed check-ins, lost Wi-Fi in one committee room or every
conference workflow error. Those signals are not present in the server-side
count-only queries. The MUNOS Executive System Health view remains authoritative
for the actual on-device situation.

Claude Code's ReadNotifications feature is not itself a Supabase Cron subscription.
You can ask Claude to read the local incident report when an alert occurs, and
later add a tested notification bridge; never make the emergency call path depend
on a dormant Claude session noticing a message.

The HTTPS Silyring webhook provides a **one-way spoken call**, not interactive
two-way AI dialogue. Your existing Silyring MCP skill remains available for
interactive calls if you separately configure a persistent agent. Calls may use
ElevenLabs speech allowance. The script limits call count and spoken message
length; it cannot measure or guarantee exact voice minutes/credits.

## Set up now, without starting

1. In the MUNOS repo on your Mac, switch to branch
   `feature/dcmun-jarvis-monitor-prep` after fetching it from origin. Do not
   overwrite unrelated local work or merge the branch to production without review.
2. Use Node.js 22+ and the existing dependencies: `npm ci`.
3. In your local `.env.local` (never commit), ensure:
   - `NEXT_PUBLIC_SUPABASE_URL=https://kllhswucdhqqywnzxado.supabase.co`
   - `NEXT_PUBLIC_CONFERENCE_ID=<your actual DCMUN conference UUID>`
   - `SUPABASE_SECRET_KEY=<local operator/server-only secret key>`
   - Optional: `MUNOS_HEALTH_URL=https://<your actual deployed staff application host>/`
   The script deliberately refuses another project reference. The key is high
   privilege; keep it in a mode-0600 local env file, not a frontend variable.
   The runner makes GET/count queries only.
4. Verify the existing Silyring key is in `~/.silyring/key`, or put
   `SILYRING_DEVICE_KEY=<key>` in the local env file. Never commit or paste the
   key in a chat. The known one-way endpoint is
   `https://api.silyring.com/call/:key`.
5. Run pure, offline tests:

   ```sh
   node --test scripts/jarvis/core.test.mjs
   ```

6. Optionally run one live **read-only** check, still fully disarmed:

   ```sh
   node --env-file=.env.local scripts/jarvis/monitor.mjs --once
   node scripts/jarvis/monitor.mjs --status
   ```

7. Prepare a LaunchAgent **without running it**:

   ```sh
   node scripts/jarvis/install-launchd.mjs --prepare
   ```

   This only writes `~/Library/LaunchAgents/com.dcmun.jarvis.monitor.plist`.
   If your secrets are in a different file, set `JARVIS_ENV_FILE` to its
   full path before preparing.

## Switch ON later, when ready

```sh
# Confirm the Supabase read succeeds and your Silyring key is available;
# this does not place a call or start a polling service.
node --env-file=.env.local scripts/jarvis/monitor.mjs --arm

# Start a 2-minute periodic LaunchAgent (first check runs immediately).
node scripts/jarvis/install-launchd.mjs --start

# Verify the state without calling anyone.
node scripts/jarvis/monitor.mjs --status
```

The Mac must remain signed in, awake, connected to the network and preferably
plugged in. A sleeping/offline Mac cannot detect or report an outage. A launchd
service handles repeated checks without keeping Claude Code open. If your Mac
cannot stay awake all weekend, Supabase Cron + Edge Functions could provide
an independent cloud backup later, but it is **not installed here**. The verified
DCMUN Production project currently has neither pg_cron nor pg_net enabled; doing
that would be a separate reviewed production change.

## Switch OFF

```sh
# Disarm first, to make calls impossible even if a scheduled check runs.
node scripts/jarvis/monitor.mjs --disarm
node scripts/jarvis/install-launchd.mjs --stop
```

All call attempts and cooldowns persist in
`~/.local/state/dcmun-jarvis/state.json`. Do not reset that file just to
bypass the safety limits. To inspect output, see
`~/.local/state/dcmun-jarvis/monitor.stdout.log`,
`monitor.stderr.log`, and `latest.md`.

## Dry-run verification and live-call policy

- `node --test scripts/jarvis/core.test.mjs` exercises healthy readings,
  database and site failures, conference disappearance, population drops,
  cooldowns and call budgets without Supabase or Silyring connections.
- `--once` when not armed makes no call, even when something is wrong.
- **No simulated failure should ever invoke the live webhook.**
- To verify actual phone ringing, request and supervise a *single* deliberate
  test call separately through the installed Silyring skill. Do not run an
  automatic outage simulation against production.
- Use the conference runbook for any real intervention. Never let this monitor
  mutate production data or "repair" a suspected problem.

## Future optional enhancements

Add safe aggregated error instrumentation to MUNOS itself (after review) to
monitor sync conflicts and server-side exceptions, plus a tested Claude
notification/incident-review bridge for ambiguous anomalies. Any new AI
inference should run only on confirmed candidate incidents and must require no
paid Anthropic API subscription.
