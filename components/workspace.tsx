"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { useConference } from "@/lib/context";
import { Role } from "@/lib/domain";
import { Icon, Chip, Timer } from "./ui";
import { ChairScreen } from "./chair";
import { Documents, Approval, Logistics } from "./documents";
import { StatusStrip, SystemHealth, SyncStatus } from "./health";
import { AdminScreen } from "./admin";
import { SubmissionLinks, SubmissionQrPanel } from "./operations/submission-links";
import { ScheduleImport } from "./operations/schedule-import";
import { ChairPhotos, PhotoReminderBanner } from "./operations/photo-reminders";
import { PhotoSchedule } from "./operations/photo-schedule";
import { DelegateSubmissions } from "./operations/resolution-links";
const roles: { id: Role; name: string; description: string; icon: string }[] = [
  {
    id: "chair",
    name: "Chair Console",
    description: "Lead the debate. Give every delegate a voice.",
    icon: "debate",
  },
  {
    id: "approval",
    name: "Approval Panel",
    description: "Review resolutions and keep submissions moving.",
    icon: "review",
  },
  {
    id: "logistics",
    name: "Logistics",
    description: "The right document, printed at the right time.",
    icon: "print",
  },
  {
    id: "admin",
    name: "Administrator",
    description: "Set up the conference. Keep the day running.",
    icon: "settings",
  },
];
const chairNav = [
  ["", "Debate", "debate"],
  ["roll-call", "Roll call", "attendance"],
  ["participation", "Participation", "log"],
  ["documents", "Documents", "documents"],
  ["voting", "Voting", "voting"],
  ["photos", "Group photos", "clock"],
  ["awards", "Award notes", "awards"],
];
const adminNav = [
  ["", "Overview", "admin"],
  ["conference", "Conference", "settings"],
  ["committees", "Committees", "debate"],
  ["sessions", "Sessions", "clock"],
  ["schedule", "Schedule import", "clock"],
  ["delegates", "Delegates", "attendance"],
  ["schools", "Schools", "admin"],
  ["photos", "Group photos", "clock"],
  ["staff", "Chairs & staff", "review"],
  ["scoring", "Scoring", "log"],
  ["awards", "Award criteria", "awards"],
  ["workflow", "Workflow & features", "settings"],
  ["submissions", "Submission links", "documents"],
  ["resources", "Resources & Drive", "documents"],
  ["audit", "Audit log", "log"],
  ["health", "System health", "settings"],
];
export function Workspace({ path }: { path: string }) {
  const {
    data,
    committeeId: requestedCommitteeId,
    setCommitteeId,
    selectedSessionId,
    setSelectedSessionId,
  } = useConference();
  const [menu, setMenu] = useState(false);
  const role = (path.split("/")[0] || "chair") as Role;
  const section = path.split("/")[1] || "";
  const committee =
    data.committees.find((c) => c.id === requestedCommitteeId) ||
    data.committees[0];
  const committeeId = committee?.id ?? "";
  const session =
    data.sessions.find(
      (s) => s.id === selectedSessionId && s.committeeId === committeeId,
    ) ||
    data.sessions.find(
      (s) => s.committeeId === committeeId && s.state === "active",
    ) ||
    data.sessions.find((s) => s.committeeId === committeeId);
  const current = data.documents.find(
    (d) => d.committeeId === committeeId && d.status === "In Debate",
  );
  if (!path)
    return (
      <main className="landing">
        <header>
          <Link href="/" className="brand">
            <Image
              className="brand-logo"
              src="/dcmun-logo.jpg"
              alt="Doha College Model United Nations"
              width={42}
              height={42}
            />
            <span>
              DCMUN<span className="brand-os"> / OS</span>
            </span>
          </Link>
          <Chip tone="neutral">Interactive demo</Chip>
        </header>
        <div className="landing-content">
          <div className="eyebrow">ONE CONFERENCE. EVERY TEAM IN SYNC.</div>
          <h1>
            A calmer
            <br />
            conference day.
          </h1>
          <p className="landing-intro">
            Less switching tabs. More moving things forward.
            <br />
            Choose your workspace to get started.
          </p>
          <div className="role-grid">
            {roles.map((r, i) => (
              <Link className="role-card" key={r.id} href={`/${r.id}`}>
                <div className={`role-icon color-${i}`}>
                  <Icon name={r.icon} />
                </div>
                <h2>{r.name}</h2>
                <p>{r.description}</p>
                <span>
                  Enter workspace <Icon name="arrow" />
                </span>
              </Link>
            ))}
          </div>
          <div className="landing-note">
            <span className="dot" />
            Shared workflow, one source of truth <span>•</span> Development edition · check System health for connection status
          </div>
          <div className="landing-bottom">
            <div>
              <strong>From first speech to final vote.</strong>
              <p>
                Attendance feeds voting. Participation informs opportunity.
                Approved resolutions become print jobs.
              </p>
            </div>
            <span className="edition">
              DCMUN-inspired
              <br />
              Demonstration edition · 2026
            </span>
          </div>
        </div>
        <footer>
          Illustrative data, not official conference records. Access-code entry is deferred. Database access requires an explicit grant.
        </footer>
      </main>
    );
  if (path === "projector")
    return (
      <main className="projector">
        <div className="eyebrow">{committee.code} · LIVE DEBATE</div>
        <h1>{current?.title || "General debate"}</h1>
        <Timer readonly sessionId={session?.id || ""} />
        <Link href="/chair">Return to Chair Console</Link>
      </main>
    );
  const roleInfo = roles.find((r) => r.id === role)!;
  const nav =
    role === "chair"
      ? chairNav
      : role === "admin"
        ? adminNav
        : [
            [
              "",
              role === "approval" ? "Review inbox" : "Print queue",
              role === "approval" ? "review" : "print",
            ],
          ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Link href="/" className="brand">
          <Image
            className="brand-logo"
            src="/dcmun-logo.jpg"
            alt="Doha College Model United Nations"
            width={42}
            height={42}
          />
          <span>
            DCMUN<span className="brand-os"> / OS</span>
          </span>
        </Link>
        <div className="conference-label">
          <span>DCMUN</span>
          <small>Conference operations · Demo</small>
        </div>
        <div className="workspace-label">{roleInfo.name}</div>
        <nav>
          {nav.map(([slug, label, icon]) => (
            <Link
              onClick={() => setMenu(false)}
              key={slug}
              href={`/${role}${slug ? `/${slug}` : ""}`}
              className={section === slug ? "active" : ""}
            >
              <Icon name={icon} />
              {label}
              {role === "chair" && slug === "documents" && (
                <span className="nav-count">
                  {
                    data.documents.filter((d) => d.committeeId === committeeId)
                      .length
                  }
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-state">
            <SyncStatus />
          </div>
          <Link href="/" className="switch-role">
            <Icon name="arrow" />
            Switch workspace
          </Link>
          <div className="user">
            <span className="avatar">
              {role === "chair"
                ? "AM"
                : role === "approval"
                  ? "SR"
                  : role === "logistics"
                    ? "NA"
                    : "CA"}
            </span>
            <div>
              <strong>{data.staff.find((s) => s.role === role)?.name}</strong>
              <small>
                {role === "chair" ? "Head chair · Demo access" : "Demo access"}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              aria-label="Toggle navigation"
              onClick={() => setMenu(!menu)}
            >
              ☰
            </button>
            <span>{roleInfo.name}</span>
            <span className="divider">/</span>
            {role === "chair" ? (
              <select
                aria-label="Select committee"
                value={committeeId}
                onChange={(e) => setCommitteeId(e.target.value)}
              >
                {data.committees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.room}
                  </option>
                ))}
              </select>
            ) : (
              <strong>Conference-wide</strong>
            )}
          </div>
          <div className="topbar-right">
            <Chip tone="neutral">DEMO</Chip>
            <span>Monday, 5 October</span>
          </div>
        </header>
        <main className="workspace-content">
          {!(role === "admin" && section === "health") && <StatusStrip />}
          {role === "chair" && <PhotoReminderBanner committeeId={committeeId} sessionId={session?.id || ""} />}
          {role === "chair" &&
            data.sessions.filter((s) => s.committeeId === committeeId).length >
              1 && (
              <div className="session-selector">
                <label>
                  Working session
                  <select
                    aria-label="Working session"
                    value={session?.id || ""}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                  >
                    {data.sessions
                      .filter((s) => s.committeeId === committeeId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          {role === "chair" ? (
            section === "photos" ? (
              <ChairPhotos committeeId={committeeId} />
            ) : section === "documents" ? (
              <>
                <DelegateSubmissions committeeId={committeeId} />
                <Documents
                  key={committeeId}
                  committeeId={committeeId}
                  sessionId={session?.id || ""}
                />
                <SubmissionQrPanel committeeId={committeeId} />
              </>
            ) : (
              <ChairScreen
                key={`${committeeId}-${session?.id}`}
                section={section}
                committeeId={committeeId}
                sessionId={session?.id || ""}
              />
            )
          ) : role === "approval" ? (
            <Approval />
          ) : role === "logistics" ? (
            <Logistics />
          ) : (
            section === "health" ? <SystemHealth /> : section === "submissions" ? <SubmissionLinks /> : section === "schedule" ? <ScheduleImport /> : section === "photos" ? <PhotoSchedule /> : <AdminScreen section={section} />
          )}
        </main>
        <footer className="workspace-footer">
          Conference OS{" "}
          <span>
            Illustrative DCMUN-inspired data · External services not connected
          </span>
        </footer>
      </div>
    </div>
  );
}
