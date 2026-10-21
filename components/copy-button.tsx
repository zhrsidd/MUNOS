"use client";
// Pattern adapted from Watermelon "Copy Confirm" (MIT), see docs/WATERMELON_LICENSE.txt.
import { useEffect, useRef, useState } from "react";
import { copyAnnouncement, createCopyController, type CopyController, type CopyState } from "@/lib/ui/copy";

/**
 * The one copy button. "Copied" appears only after the clipboard write succeeds; when the browser refuses (or has
 * no Clipboard API) the label asks the person to select and copy, and `onFailure` lets the caller select the field.
 * All three labels share one grid cell, so the button keeps the width of the longest and never shifts layout.
 */
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Select and copy",
  failedAnnouncement = "Copy failed. Select the text and copy it manually.",
  onFailure,
  className,
  ...rest
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  failedLabel?: string;
  failedAnnouncement?: string;
  onFailure?: () => void;
  className?: string;
} & Pick<React.AriaAttributes, "aria-describedby">) {
  const [state, setState] = useState<CopyState>("idle");
  const controller = useRef<CopyController | null>(null);
  useEffect(() => {
    const created = createCopyController({ onState: setState });
    controller.current = created;
    return () => {
      created.cancel();
      controller.current = null;
    };
  }, []);
  const labels: [CopyState, string][] = [["idle", label], ["copied", copiedLabel], ["failed", failedLabel]];
  return (
    <>
      <button type="button" {...rest} className={`copy-button${className ? ` ${className}` : ""}`} onClick={() => void controller.current?.copy(text, onFailure)}>
        <span className="copy-labels">
          {labels.map(([key, value]) => (
            <span key={key} data-active={state === key ? "true" : "false"} aria-hidden={state === key ? undefined : "true"}>{value}</span>
          ))}
        </span>
      </button>
      <span className="sr-only" role="status">{copyAnnouncement(state, `${copiedLabel}.`, failedAnnouncement)}</span>
    </>
  );
}
