"use client";
import { useEffect, useState, useRef, useId } from "react";
import { Delegate, Role, stages } from "@/lib/domain";
import { useConference } from "@/lib/context";
export function Chip({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span
      className={`chip ${tone || String(children).toLowerCase().replaceAll(" ", "-")}`}
    >
      {children}
    </span>
  );
}
export function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    debate: (
      <>
        <path d="M4 5h16v11H9l-5 4V5Z" />
        <path d="M8 9h8M8 12h5" />
      </>
    ),
    attendance: (
      <>
        <path d="m3 7 2 2 4-4m-6 9 2 2 4-4M12 7h9M12 14h9M12 20h9" />
      </>
    ),
    documents: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h4M9 12h6M9 16h6" />
      </>
    ),
    voting: (
      <>
        <path d="m8 3 8 5-4 6-8-5 4-6Z" />
        <path d="M5 13H3v8h18v-8h-4M8 17h8" />
      </>
    ),
    awards: (
      <>
        <path d="M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 13v5M8 21h8M9 18h6" />
      </>
    ),
    admin: (
      <>
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
      </>
    ),
    log: (
      <>
        <path d="M5 4h14v17H5zM9 8h6M9 12h6M9 16h4" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    print: (
      <>
        <path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 14h10v7H7z" />
        <path d="M17 11h1" />
      </>
    ),
    review: (
      <>
        <path d="M12 3 3 7v6c0 4 9 8 9 8s9-4 9-8V7l-9-4Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.admin}
    </svg>
  );
}
export function DelegateIdentity({
  delegate,
  detail = false,
}: {
  delegate: Delegate;
  detail?: boolean;
}) {
  const { data } = useConference();
  return (
    <div className="identity">
      <span className="flag">{delegate.flag}</span>
      <div>
        <strong>{delegate.country}</strong>
        <span>
          {delegate.name}
          {detail &&
            ` · ${data.schools.find((s) => s.id === delegate.schoolId)?.name}`}
        </span>
      </div>
    </div>
  );
}
export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <span>✓</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="modal"
      onCancel={onClose}
    >
      <div className="panel-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Timeline({ status }: { status: string }) {
  return (
    <div className="timeline">
      {stages.map((s, i) => (
        <div
          key={s}
          className={
            i <= stages.indexOf(status as (typeof stages)[number]) ? "done" : ""
          }
        >
          <span>
            {i < stages.indexOf(status as (typeof stages)[number])
              ? "✓"
              : i + 1}
          </span>
          <small>{s}</small>
        </div>
      ))}
    </div>
  );
}
export function Timer({
  role = "chair",
  readonly = false,
  sessionId,
}: {
  role?: Role;
  readonly?: boolean;
  sessionId: string;
}) {
  const { data, act } = useConference();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, []);
  const t = data.timers[sessionId] || {
    duration: 90,
    remaining: 90,
    startedAt: null,
  };
  const remaining = Math.max(
    0,
    Math.ceil(
      t.remaining - (t.startedAt && now ? (now - t.startedAt) / 1000 : 0),
    ),
  );
  return (
    <div className={`timer ${remaining === 0 ? "expired" : ""}`}>
      <div className="timer-top">
        <span>
          <Icon name="clock" /> SPEAKER TIMER
        </span>
        <span>
          {t.startedAt && remaining > 0
            ? "Running"
            : remaining === 0
              ? "Time elapsed"
              : "Ready"}
        </span>
      </div>
      <div
        className="timer-digits"
        aria-label={`${remaining} seconds remaining`}
      >
        {String(Math.floor(remaining / 60)).padStart(2, "0")}
        <span>:</span>
        {String(remaining % 60).padStart(2, "0")}
      </div>
      <div className="timer-progress">
        <div
          style={{ width: `${Math.min(100, (remaining / t.duration) * 100)}%` }}
        />
      </div>
      {!readonly && (
        <>
          <div className="timer-actions">
            <button
              className="primary"
              onClick={() =>
                void act(
                  {
                    type: "timer",
                    sessionId,
                    remaining: t.startedAt
                      ? remaining
                      : remaining || t.duration,
                    startedAt: t.startedAt ? null : Date.now(),
                    duration: t.duration,
                  },
                  role,
                )
              }
            >
              {t.startedAt ? "Ⅱ Pause" : "▶ Start timer"}
            </button>
            <button
              onClick={() =>
                void act(
                  {
                    type: "timer",
                    sessionId,
                    remaining: t.duration,
                    startedAt: null,
                    duration: t.duration,
                  },
                  role,
                )
              }
            >
              ↻ Reset
            </button>
          </div>
          <div className="duration-options">
            {[60, 90, 120, 180].map((n) => (
              <button
                key={n}
                className={t.duration === n ? "selected" : ""}
                onClick={() =>
                  void act(
                    {
                      type: "timer",
                      sessionId,
                      remaining: n,
                      startedAt: null,
                      duration: n,
                    },
                    role,
                  )
                }
              >
                {n}s
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
