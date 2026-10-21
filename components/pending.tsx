"use client";
// Pattern adapted from Watermelon "Spinner" (MIT), see docs/WATERMELON_LICENSE.txt.
import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { createPendingIndicator, type PendingIndicator } from "@/lib/ui/pending";

/**
 * True once `pending` has lasted PENDING_INDICATOR_DELAY_MS, and false again the moment it ends.
 * Use it for controls doing real asynchronous work; it never delays or lengthens the work itself.
 */
export function usePendingIndicator(pending: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const controller = useRef<PendingIndicator | null>(null);
  useEffect(() => {
    const created = createPendingIndicator(setVisible);
    controller.current = created;
    return () => {
      created.dispose();
      controller.current = null;
    };
  }, []);
  useEffect(() => {
    controller.current?.set(pending);
  }, [pending]);
  return pending && visible;
}

/** A 16 px ring. Decorative: the accessible description lives on the control that owns it, once. */
export function Spinner({ active = true }: { active?: boolean }) {
  return <span className="spinner" data-active={active ? "true" : "false"} aria-hidden="true" />;
}

type PendingButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-busy"> & {
  /** The operation is running. The ring appears after the pending delay; the label never changes. */
  pending: boolean;
  /** Spoken once, through a single status region, when the ring appears. */
  pendingLabel: string;
};
/**
 * A button that owns a reserved 16 px slot beside a stable label, so showing the ring never changes its width.
 * Callers keep their own `disabled` logic; the ring only says "working", never "saved" or "synced".
 */
export function PendingButton({ pending, pendingLabel, className, children, type = "button", ...rest }: PendingButtonProps) {
  const visible = usePendingIndicator(pending);
  return (
    <>
      <button {...rest} type={type} className={`pending-button${className ? ` ${className}` : ""}`} aria-busy={pending || undefined}>
        <Spinner active={visible} />
        {children}
      </button>
      <span className="sr-only" role="status">{visible ? pendingLabel : ""}</span>
    </>
  );
}
