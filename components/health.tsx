"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useConference } from "@/lib/context";
import { staffRoleForPath } from "@/lib/access";
import { saveStatus } from "@/lib/save-status";
import { repository } from "@/lib/repository";
import { buildInfo, releaseLabel } from "@/lib/platform/build-info";
import type { HealthReport } from "@/lib/platform/health-probe";
import { systemStatus, type Level, type SystemStatus } from "@/lib/platform/system-status";

const levelLabel: Record<Level, string> = { green: "GREEN", yellow: "YELLOW", red: "RED" };
const cloudExpected = process.env.NEXT_PUBLIC_DATA_BACKEND === "supabase";
const subscribeOnline = (f: () => void) => {
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  return () => {
    window.removeEventListener("online", f);
    window.removeEventListener("offline", f);
  };
};
function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
/** Polls /api/health only while the health screen is visible: once a minute and when the network returns. */
function useServerHealth(enabled: boolean) {
  const [server, setServer] = useState<HealthReport | null | "unreachable">(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        const body = (await response.json()) as HealthReport;
        if (!stopped) setServer(body);
      } catch {
        if (!stopped) setServer("unreachable");
      }
    };
    void check();
    const timer = setInterval(check, 60_000);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled]);
  return server;
}
/** Re-evaluates time-based rules (stale changes) without any network activity. */
function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
export function useSystemStatus(withServer = false): { status: SystemStatus; server: HealthReport | null | "unreachable" } {
  const health = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  const online = useOnline();
  const server = useServerHealth(withServer);
  const now = useNow(30_000);
  const oldestPendingAt = health.pending ? repository.getPending()[0]?.createdAt : undefined;
  return {
    status: systemStatus({ health, online, cloudExpected, oldestPendingAt, server, clientCommit: buildInfo.commit, now }),
    server,
  };
}
export function SystemHealth() {
  const health = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  const { status, server } = useSystemStatus(true);
  const [exported, setExported] = useState(false);
  async function exportChanges() {
    const text = await repository.exportRecovery();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `conference-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setExported(true);
  }
  return (
    <section className="health-screen">
      <div className="eyebrow">STAFF · SYSTEM HEALTH</div>
      <h1>System health</h1>
      <p className="muted">Is Conference OS working on this device right now? Keep a device open until its changes are synced.</p>
      <div className={`status-banner ${status.level}`} role="status" aria-live="polite">
        <span className="status-light" aria-hidden="true" />
        <div>
          <small>{levelLabel[status.level]}</small>
          <strong>{status.headline}</strong>
          <p>{status.message}</p>
        </div>
      </div>
      <ul className="status-list">
        {status.items.map((item) => (
          <li key={item.key} className={item.level}>
            <span className="status-dot" aria-label={levelLabel[item.level]} />
            <span>{item.label}</span>
            <strong>{item.text}</strong>
          </li>
        ))}
        <li className="info">
          <span className="status-dot" aria-hidden="true" />
          <span>Running version</span>
          <strong>{releaseLabel()}</strong>
        </li>
        <li className="info">
          <span className="status-dot" aria-hidden="true" />
          <span>Last successful sync</span>
          <strong>{health.lastSynced ? new Date(health.lastSynced).toLocaleTimeString("en-GB") : "Not yet synced"}</strong>
        </li>
      </ul>
      <div className="callout small">
        <div>
          <strong>What the colours mean</strong>
          <p>
            <b>GREEN</b> carry on. <b>YELLOW</b> carry on; something is degraded and recovers automatically. <b>RED</b> stop
            recording on this device and contact the Executive. See CONFERENCE_RUNBOOK.md.
          </p>
        </div>
      </div>
      <div className="actions">
        <button className="button primary" onClick={() => repository.retry()}>
          Retry connection
        </button>
        <button className="button" onClick={() => void exportChanges()}>
          Export device recovery file
        </button>
      </div>
      <p className="muted">
        Recovery files contain delegate details. Give them only to the Executive and delete them after recovery is confirmed. Never clear
        browser data while changes are waiting.
      </p>
      <details>
        <summary>Technical details</summary>
        <dl className="tech-details">
          <dt>Data mode</dt>
          <dd>{health.mode === "supabase" ? "Conference database (Supabase)" : cloudExpected ? "Local fallback (cloud expected)" : "Local demo"}</dd>
          <dt>Sync state</dt>
          <dd>
            {health.state} · {health.message}
          </dd>
          {health.detail && (
            <>
              <dt>Last error</dt>
              <dd className="wrap-anywhere">{health.detail}</dd>
            </>
          )}
          <dt>Database latency</dt>
          <dd>{health.latency === null ? "Not measured" : `${health.latency} ms`}</dd>
          <dt>Unsynced / conflicts</dt>
          <dd>
            {health.pending} / {health.conflicts}
            {health.awaitingConfirmation ? ` · ${health.awaitingConfirmation} already received by the server, awaiting confirmation` : ""}
          </dd>
          {(health.errorKind || health.retryAt) && (
            <>
              <dt>Sync failure</dt>
              <dd className="wrap-anywhere">
                {health.errorKind === "overload" ? "Database busy / timed out" : health.errorKind === "network" ? "Network" : health.errorKind === "conflict" ? "Needs review" : "Other"}
                {health.errorCode ? ` (${health.errorCode})` : ""}
                {health.retryAttempt ? ` · automatic retry #${health.retryAttempt}` : ""}
                {health.retryAt ? ` due ${new Date(health.retryAt).toLocaleTimeString("en-GB")}` : ""}
              </dd>
            </>
          )}
          {health.actorId && (
            <>
              <dt>Device user</dt>
              <dd className="wrap-anywhere">{health.actorId}</dd>
            </>
          )}
          <dt>Build</dt>
          <dd className="wrap-anywhere">
            {buildInfo.version} · {buildInfo.commit || "no commit"} · {buildInfo.branch || "no branch"} · {buildInfo.environment} ·{" "}
            {buildInfo.deploymentId || "no deployment id"} · built {buildInfo.builtAt || "unknown"}
          </dd>
          <dt>Service check</dt>
          <dd className="wrap-anywhere">
            {server === null
              ? "Checking…"
              : server === "unreachable"
                ? "/api/health did not respond"
                : `${server.status} · Supabase ${server.checks.supabase.status}${server.checks.supabase.latencyMs !== undefined ? ` (${server.checks.supabase.latencyMs} ms)` : ""} · Database ${server.checks.database?.status ?? "not reported"} · Storage ${server.checks.storage.status} · server build ${server.app.commit.slice(0, 7) || "local"} · ${new Date(server.checkedAt).toLocaleTimeString("en-GB")}`}
          </dd>
        </dl>
      </details>
      {repository
        .getPending()
        .filter((m) => m.state === "conflict")
        .map((m) => (
          <article className="panel" key={m.id}>
            <h3>Review saved {m.command.type} change</h3>
            <p>{m.message}</p>
            <details>
              <summary>Original saved action</summary>
              <pre>{JSON.stringify(m.command, null, 2)}</pre>
            </details>
            <p>Export first. Check the current conference value, then dismiss this saved action and enter the intended change again if needed.</p>
            <button
              className="button"
              disabled={!exported}
              onClick={() => {
                if (window.confirm("Dismiss this exported action and keep the current conference value?")) void repository.resolveConflict(m.id);
              }}
            >
              Keep conference value · dismiss exported action
            </button>
          </article>
        ))}
    </section>
  );
}
/** Always-present sync strip below navigation; reuses the reviewed save-state language. */
export function SaveStatus() {
  const { status } = useSystemStatus(false);
  const { access } = useConference();
  const h = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  const area = staffRoleForPath(usePathname() ?? "") ?? "chair";
  const online = !status.items.some((i) => i.key === "internet" && i.level !== "green");
  const info = saveStatus({ health: h, online, access: access.status });
  return (
    <div className={`save-status ${info.tone}`}>
      <div className="save-status-inner">
        <span className="status-dot" aria-hidden="true" />
        <span className="save-status-message" role="status" aria-live="polite" aria-atomic="true">{info.label.replace(/ · open details$/, "")}</span>
        <Link href={`/${area}/health`} className="save-status-details">Open details</Link>
      </div>
    </div>
  );
}
/** Compact indicator for the sidebar. Client-side signals only; never polls the server. */
export function SyncStatus() {
  const { status } = useSystemStatus(false);
  const h = useSyncExternalStore(repository.subscribe, repository.getHealth, repository.getHealth);
  return (
    <span className={`sync-status ${status.level}`} title={status.message}>
      <span className="status-dot" aria-hidden="true" />
      <span>
      {status.level === "green" ? h.message : status.headline}
      <small>{h.mode === "supabase" ? `${levelLabel[status.level]} · conference database` : "Local demo · cloud unavailable"}</small>
      </span>
    </span>
  );
}
export function DataModeLabel(){
 const h=useSyncExternalStore(repository.subscribe,repository.getHealth,repository.getHealth);
 return <span>{h.mode==='supabase'?'Supabase development':'Local demo'}</span>;
}
