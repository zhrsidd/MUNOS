# Sync: re-check the outbox after an in-flight read

Protected area (offline sync). Independent Codex review is required before merge.

## Finding

Reported by the automated offline rehearsal on hosted staging and independently reproduced by Codex on the exact base
(fake IndexedDB, deferred opening snapshot, deterministic timers).

`DurableRepository.execute()` records the action durably and calls `flush()`. `flush()` returns immediately while another
flush is running. When that flush was already past its batch step (the opening, idle or final read), nothing looked at
the outbox again when it finished, so the new action waited for the next poll: 60 s without Realtime, 120 s with it
(each ±20%). In Codex's reproduction one queued action stayed unsent after the read completed and was sent exactly once
at 120000 ms. Nothing was lost or duplicated; a Chair could see "Saved on this device" for up to about 2.4 minutes.

A read in flight during the *confirmation* step was already safe: the batch loop re-reads the outbox after each confirm.

## Fix

In `flush()` (`lib/sync/repository.ts`), after the `finally` block (flag cleared, next poll armed), a run that did not
throw calls `flush()` again if the head of the outbox is sendable (`hasSendableWork()`: transport present, not disposed,
outbox non-empty, head not in conflict). Two small additions: a `failed` flag set in the `catch`, and the private
`hasSendableWork()` helper.

## Review notes for Codex

Invariants preserved (none edited):

- One flush at a time: the re-flush starts only after `flushing=false`, and still goes through the same `flushing` guard
  and the same `navigator.locks` request. Tests assert at most one transport request in flight.
- `MAX_BATCH` and acknowledgement tracking: the batch loop, `acked` set and `confirm()` are untouched. The re-check only
  starts another normal flush, which sends in order, at most `MAX_BATCH` per confirming read, never resending acknowledged
  actions.
- Conflict blocking: no re-flush when the head of the outbox is a conflict, so nothing behind it is sent and no extra
  read is made.
- Overload and failure backoff: no re-check after a failed flush (`failed`), so a failed read or send follows the
  existing `retryDelay` path with `attempts` incremented. A successful flush already reset `attempts` and `lastKind`, so
  the re-check cannot override a live backoff. The `execute()` overload guard is unchanged.
- Dispose: `hasSendableWork()` is false once disposed; `schedule()` already refuses to arm a timer after dispose.
- Termination: after a successful run the loop has drained every sendable entry, so the re-check fires only when an
  action was recorded after the loop's last look at the outbox. It cannot loop on its own.
- No schema, idempotency, mutation UUID, fingerprint, `Transport` or `store.ts` change.

Diff scope: `lib/sync/repository.ts` (+11 lines), `tests/sync-flush-recheck.test.ts` (new), this document.

Tests (`tests/sync-flush-recheck.test.ts`, fake-indexeddb, manual clock for timers of 250 ms or more, jitter fixed to 0):
(a)/(i) opening read with Realtime on (Codex's scenario), (b) idle read, (c) confirmation read, (d) read failure,
(e) conflict, (f) overload ladder, (g) dispose, (h) more than one `MAX_BATCH`. On the base commit (a), (b) and (h) fail
because the action is not sent when the read completes; the rest are guards that pass both before and after.
