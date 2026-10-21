// Pattern adapted from Watermelon "Copy Confirm" (MIT), see docs/WATERMELON_LICENSE.txt.
// Pure clipboard feedback logic so the rules are testable without a DOM: "copied" is reported only after the
// clipboard write resolves; a refusal, a throw or a missing Clipboard API is reported as a failure.

export type CopyState = "idle" | "copied" | "failed";
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}
/** How long "Copied" stays before the label returns to normal. */
export const COPIED_RESET_MS = 2000;
/** A failure prompt asks the person to act, so it is held a little longer to be read. */
export const COPY_FAILED_RESET_MS = 4000;

export interface CopyControllerOptions {
  onState(state: CopyState): void;
  /** Resolved on every click, so the Clipboard API is looked up at the moment of use. */
  clipboard?: () => ClipboardLike | undefined;
  copiedResetMs?: number;
  failedResetMs?: number;
}
export interface CopyController {
  copy(text: string, onFailure?: () => void): Promise<CopyState>;
  /** Stops the revert timer and ignores any write still in flight. Safe to call more than once, and to keep using afterwards. */
  cancel(): void;
}

const browserClipboard = (): ClipboardLike | undefined => (typeof navigator === "undefined" ? undefined : navigator.clipboard);

export function createCopyController(options: CopyControllerOptions): CopyController {
  const { onState, clipboard = browserClipboard, copiedResetMs = COPIED_RESET_MS, failedResetMs = COPY_FAILED_RESET_MS } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  const stopTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    async copy(text, onFailure) {
      // A new click supersedes the previous one: its timer is dropped and a late answer to it is ignored.
      const mine = ++generation;
      stopTimer();
      let result: CopyState = "failed";
      try {
        const api = clipboard();
        if (api && typeof api.writeText === "function") {
          await api.writeText(text);
          result = "copied";
        }
      } catch {
        result = "failed";
      }
      if (mine !== generation) return result;
      onState(result);
      if (result === "failed") {
        try {
          onFailure?.();
        } catch {
          // A failed fallback (for example selecting an unmounted field) must not hide the failure message.
        }
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (mine === generation) onState("idle");
      }, result === "copied" ? copiedResetMs : failedResetMs);
      return result;
    },
    cancel() {
      generation++;
      stopTimer();
    },
  };
}

/** The one polite announcement for a state; empty when idle so reverting is silent. */
export function copyAnnouncement(state: CopyState, copied: string, failed: string): string {
  return state === "copied" ? copied : state === "failed" ? failed : "";
}
