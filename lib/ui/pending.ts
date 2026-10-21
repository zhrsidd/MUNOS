// Pattern adapted from Watermelon "Spinner" (MIT), see docs/WATERMELON_LICENSE.txt.

/** A pending indicator appears only once an operation has run this long; shorter ones never flash. */
export const PENDING_INDICATOR_DELAY_MS = 300;

export interface PendingIndicator {
  /** Report whether the operation is running. Going false hides the indicator at once. */
  set(pending: boolean): void;
  dispose(): void;
}

/**
 * Turns "operation is pending" into "show the indicator". The indicator is shown after a delay and hidden
 * immediately when the operation ends: it never holds back a result or imposes a minimum visible time.
 */
export function createPendingIndicator(onChange: (visible: boolean) => void, delayMs = PENDING_INDICATOR_DELAY_MS): PendingIndicator {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let visible = false;
  const show = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    onChange(next);
  };
  const stop = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    set(pending) {
      if (!pending) {
        stop();
        show(false);
      } else if (!visible && timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          show(true);
        }, delayMs);
      }
    },
    dispose() {
      stop();
      visible = false;
    },
  };
}
