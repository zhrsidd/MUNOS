# Automated multi-device offline rehearsal

`scripts/rehearsal/offline-multi-device.mjs` drives several independent Chair devices (one Playwright browser context each:
separate IndexedDB outbox, service worker, cookies and network switch) through an outage, queued work, reconnect, retries,
idempotency, a stale conflict, a reload while offline, and a final consistency check. It is verification only; it is **not** part
of `npm test` or CI.

Two modes:

| | DEMO (default) | HOSTED |
| --- | --- | --- |
| Target | local `next start` of a demo build, started and stopped by the script | a deployed build pointing at an **isolated, temporary, labelled TEST conference** on a staging project |
| Server | none (demo has no transport and no outbox) | Supabase RPCs, receipts, PT409 |
| Safe to run anywhere | yes | **only** when the orchestrator has provisioned the temporary conference |

## Run the demo rehearsal

Playwright is not a project dependency. Use any copy, e.g. the scratch one, through `NODE_PATH` (or `REHEARSAL_PLAYWRIGHT_DIR`):

```
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers      # an existing Chromium; do not run `playwright install` here
export NODE_PATH=<dir>/node_modules                   # contains `playwright`
REHEARSAL_BUILD=1 npm run test:rehearsal:offline      # builds the demo app first (next build --webpack, NEXT_PUBLIC_* unset)
npm run test:rehearsal:offline                        # reuses an existing demo build in .next
```

Optional: `REHEARSAL_DEMO_URL` (use a running demo server instead), `REHEARSAL_CHROMIUM_PATH`, `REHEARSAL_HEADED=1`,
`REHEARSAL_ARTIFACT_DIR` (failure screenshots and `report.json`, default under the OS temp dir), `REHEARSAL_DEBUG=1`.
The script picks a free port and stops only the server process it started. A hosted build left in `.next` is detected (S0 checks
the data mode).

## What each scenario asserts

Lines marked **H** run only in hosted mode; demo prints them as `SKIP (hosted only)`.

- **S0 Setup.** Two contexts open `/chair/roll-call`; data mode is the expected one; the service worker controls both; five
  delegates are present; both outboxes are empty and the strip is healthy.
- **S1 Independence.** A records attendance durably in its own IndexedDB. Demo: B is unchanged (no server carries it). **H** B
  converges to A's change.
- **S2 Offline queue.** `setOffline(true)` on A: the strip says Offline. Attendance, speaker-queue add, speech start/score/finish,
  participation points and a vote are all usable and shown at once. Demo: written to the device store, `Offline` strip. **H**
  exactly 7 mutations in the outbox (types checked), strip `Offline · 7 changes saved on this device`, nothing on the server, B unchanged.
- **S3 Reload offline.** Reload with the network off: the cached shell loads, outbox ids and data are identical, the strip is
  unchanged, the offline attendance choice is still selected, no page errors.
- **S4 Reconnect.** Going online drains with no operator action; every action has taken effect exactly once (one speech, +2
  events, points +2, one vote, floor returned, no duplicate ids). **H** strip ends `All changes synced`; B converges to the server.
- **S5 Retry.** Hosted: request 1 is aborted before the server, request 2 reaches the server but its response is lost, request 3
  passes; the action stays queued, the same mutation is retried, the server shows one effect. Demo: `/api/health` is aborted;
  System health reports it and a save made during the failure is applied exactly once.
- **S6 Idempotency.** A double-tap on Next speaker and on the speech score starts one speech and records one score; a reload
  replays nothing; no duplicate ids. **H** the identical request (same mutation uuid) is delivered to the server twice and
  applied once (+2, not +4).
- **S7 Stale conflict.** **H** A is offline and edits delegate X's attendance, with a participation action queued behind it. B edits
  X online. A reconnects: the strip says `Review needed`; the change is retained and flagged, did not overwrite B, work behind it
  stays queued and unsent; System health lists "Review saved attendance change" with the original action; Retry does not force
  it; Discard is disabled until Export (the JSON contains the action); Discard keeps the conference value and the queued
  participation arrives exactly once; A converges to B's value. Demo: two tabs of one device (BroadcastChannel muted in one): the
  stale save is refused with "Another tab updated this item" and the newer value is kept.
- **S8 System health.** Retry is harmless, Export gives valid JSON of the device checkpoint, no conflict panel without a conflict.
- **S9 Final consistency.** Empty outboxes; no duplicate event/vote/queue/speech ids; the on-screen leaderboard equals the points
  derived from the stored events (points counted once); no uncaught page errors. **H** A, B and the server hold the same
  attendance, events, points, votes, queue and speeches, and both strips say `All changes synced`. Demo: the two devices differ,
  which documents that devices converge only through a server.

### Hosted-only (cannot be exercised in demo mode)

Outbox contents and strip counts while offline, drain on reconnect, retry of aborted/lost requests, server-side idempotency and
receipts, PT409 conflicts, Review/Retry/Discard recovery, cross-device convergence and server-state equality.

### Known finding (benign, product code untouched)

When the stale-tab check rejects a save, `DurableStore.update()` aborts its IndexedDB transaction and the aborted `tx.done`
promise is unhandled, so the browser logs one `AbortError`. The refusal itself is handled. The script tolerates exactly this in
S7 (demo) and prints a NOTE; any other page error fails the run.

## Hosted mode (orchestrator only)

The orchestrator provisions an **isolated temporary conference** on a staging project: name or venue containing `TEST` or
`temporary`; at most 5 committees; a committee (default code `TST`) with at least 5 delegates, a current session set, and one
resolution In Debate (or set `REHEARSAL_SKIP_VOTES=1`). Never use an existing conference or its Executive code.

Preflight (all before any browser; a refusal exits non-zero) in `scripts/rehearsal/offline-hosted.mts`: target ref must be a
hosted project, never PHESMUN or the production ref, and **must be in `STAGING_SUPABASE_REFS`**;
`REHEARSAL_CONFIRM_TEMP_CONFERENCE_ID` must equal `NEXT_PUBLIC_CONFERENCE_ID`; after the Executive snapshot the conference must be
marked TEST/temporary, small, and have the fixture. Output carries project ref and ids only, never codes.

Environment (values are read, never printed):

```
REHEARSAL_MODE=hosted
REHEARSAL_BASE_URL=https://<deployment built for the staging project>
NEXT_PUBLIC_SUPABASE_URL  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  NEXT_PUBLIC_CONFERENCE_ID   (the target the deployment was built for)
STAGING_SUPABASE_REFS=<ref>
REHEARSAL_CONFIRM_TEMP_CONFERENCE_ID=<same conference id>
REHEARSAL_EXEC_CODE=<Executive code of the temporary conference>
REHEARSAL_COMMITTEE_CODE=TST                          # optional
one of: REHEARSAL_CHAIR_CODE | REHEARSAL_CODES_FILE | REHEARSAL_MINT=1
```

Mint a Chair code into a private file (outside the repo, mode 0600; prints ids only):

```
REHEARSAL_CODES_FILE=/private/codes.json node --import tsx scripts/rehearsal/offline-hosted.mts mint
REHEARSAL_MODE=hosted ... node --import tsx scripts/rehearsal/offline-multi-device.mjs
```

Both Chair devices redeem the same Chair code (separate anonymous identities). Authoritative server state is read by a third,
read-only Chair identity through `SupabaseTransport`: the Executive snapshot does not carry events, speeches or votes. The
Executive session is used for the preflight and for minting codes. Assertions are deltas from a baseline read at the start of the
scenario, so the run can be repeated on the same fixture. Set `REHEARSAL_PROBE_SEND_LATENCY=1` to add the informational S10 probe.

## Hosted run record (21 October 2026)

Run against the isolated temporary conference "TEST Offline Rehearsal (temporary)" on staging project `kllhswucdhqqywnzxado`
(deployment built for it, served locally), twice in a row: **S0 to S9 all PASS, 39 assertions, 0 failed**; S10 probe 127 s (below).

Script defects found and fixed during the first hosted runs (not product defects):
1. `getByLabel('Staff access code')` matched two elements, so strict mode threw and the gate was never filled. The gate is now
   found by its password input and filled only while the signed-out gate ("Enter staff access code") is showing and the device is
   online; it is polled and never blocks, because the gate can flash while the workspace restores after an offline reload.
2. The Executive snapshot has no Chair-level rows, so "the server has nothing / one effect" checks read zero. A read-only Chair
   auditor identity now provides the server view.
3. The debate console offers "Next speaker" only when someone is queued; S6 queues a delegate when needed.
4. Route rules are removed in `finally`, so a failed scenario cannot leak a fault rule into the next one.

### Product finding (not fixed; product code frozen)

**An action recorded while the device's sync read is in flight is not sent until the next automatic poll.**
`DurableRepository.execute()` calls `flush()`, which returns immediately while another flush is running (`this.flushing`). If
that flush is already past its batch step (the opening or idle snapshot read), nothing re-checks the outbox when it finishes;
`schedule()` then waits `pollDelay` (60 s without Realtime, 120 s with, +-20%). Measured by the S10 probe: open
`/chair/participation`, record points at once, no focus or online event: the action sat in the outbox for **127 s**, then sent and
applied once. Nothing is lost or duplicated, and focus, going online or a later action sends it sooner, but a Chair who records
during the opening read can see "Saved on this device" for up to about 2.4 minutes. Suggested fix (needs the sync owner and
independent review): when a flush finishes, if the outbox has unsent work, flush again. S5 and S6 call `settle()` first so they
test retry and idempotency rather than this race.
