"use client";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConference } from "@/lib/context";
import { Role } from "@/lib/domain";
import { soleWorkspacePath } from "@/lib/access";
import { Icon, Chip, Panel } from "./ui";
import { Brand } from "./brand";
import { ChairScreen } from "./chair";
import { Documents, Approval, Logistics } from "./documents";
import { StatusStrip, SystemHealth, SyncStatus, DataModeLabel } from "./health";
import { AdminScreen } from "./admin";
import { SubmissionLinks, SubmissionQrPanel } from "./operations/submission-links";
import { AccessCodes } from "./access-codes";
import { CentralSessions } from "./central-sessions";
import { AmendmentLinks } from "./amendments/links";
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
    name: "Admins",
    description: "The right document, printed at the right time.",
    icon: "print",
  },
  {
    id: "admin",
    name: "Executive",
    description: "Set up the conference. Keep the day running.",
    icon: "settings",
  },
];
// [route, label, icon, group]. An empty group is the everyday work; named groups sit quietly below it.
const chairNav = [
  ["", "Debate", "debate", ""],
  ["roll-call", "Roll call", "attendance", ""],
  ["participation", "Participation", "log", ""],
  ["documents", "Resolutions", "documents", ""],
  ["amendments", "Amendments", "documents", ""],
  ["voting", "Voting", "voting", ""],
  ["photos", "Group photos", "clock", "More"],
  ["awards", "Award discussion", "awards", "More"],
  ["health", "System health", "settings", "More"],
];
const adminNav = [
  ["", "Overview", "admin", ""],
  ["conference", "Conference", "settings", "Set up"],
  ["committees", "Committees", "debate", "Set up"],
  ["sessions", "Sessions", "clock", "Set up"],
  ["delegates", "Delegates", "attendance", "Set up"],
  ["schools", "Schools", "admin", "Set up"],
  ["staff", "Chairs & staff", "review", "Set up"],
  ["photos", "Group photos", "clock", "Run the day"],
  ["submissions", "Resolution links", "documents", "Run the day"],
  ["amendment-links", "Amendment links", "documents", "Run the day"],
  ["access-codes", "Access codes", "settings", "Run the day"],
  ["scoring", "Scoring", "log", "Run the day"],
  ["workflow", "Workflow & features", "settings", "Run the day"],
  ["audit", "Audit log", "log", "Records"],
  ["health", "System health", "settings", "Records"],
];
export function Workspace({ path }: { path: string }) {
  const {
    data,
    committeeId: requestedCommitteeId,
    setCommitteeId,
    act,
    access,
  } = useConference();
  const [now] = useState(()=>Date.now());
  const [menu, setMenu] = useState(false);
  const router = useRouter();
  // A staff member with exactly one workspace goes straight in; the picker is only for people with a choice.
  const soleWorkspace = !path ? soleWorkspacePath(access) : null;
  useEffect(() => { if (soleWorkspace) router.replace(soleWorkspace); }, [soleWorkspace, router]);
  const role = (path.split("/")[0] || "chair") as Role;
  const section = path.split("/")[1] || "";
  const activeCommittees = data.committees.filter(c => !c.archived && (!(role==='chair') || access.status!=='active' || access.committeeIds.includes(c.id)));
  const availableRoles = access.status === "active" ? roles.filter(r => access.roles.includes(r.id)) : roles;
  const committee =
    activeCommittees.find((c) => c.id === requestedCommitteeId) ||
    activeCommittees.find(c=>c.code === "GA1") || activeCommittees[0];
  const committeeId = committee?.id ?? "";
  const session = data.sessions.find(s=>s.id===committee?.currentSessionId && s.committeeId===committeeId && !s.archived);
  const suggestedSession=data.sessions.find(s=>s.committeeId===committeeId && !s.archived && Date.parse(s.startsAt)<=now && (!s.endsAt || Date.parse(s.endsAt)>now));
  // While access is still loading the picker would flash every workspace, including ones this person cannot enter.
  if (soleWorkspace || (!path && access.status === "loading")) return <main className="landing"><p role="status">Opening your workspace…</p></main>;
  if (!path)
    return (
      <main className="landing">
        <header>
          <Brand />
          <Chip tone="neutral">{access.status === "active" ? "Staff workspace" : "Interactive demo"}</Chip>
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
            {availableRoles.map((r, i) => (
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
          {access.status === "active" ? "Choose one of your assigned workspaces. Conference access is controlled by your staff grant." : "Illustrative data, not official conference records. Local demo roles are for exploration."}
        </footer>
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
              "",
            ],
            ["health", "System health", "settings", ""],
          ];
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Brand />
        <div className="workspace-label">{roleInfo.name}</div>
        <nav>
          {nav.map(([slug, label, icon, group], i) => (
            <Fragment key={slug}>
              {group && group !== nav[i - 1]?.[3] && <div className="nav-group">{group}</div>}
              <Link
                onClick={() => setMenu(false)}
                href={`/${role}${slug ? `/${slug}` : ""}`}
                className={section === slug ? "active" : ""}
                aria-current={section === slug ? "page" : undefined}
              >
                <Icon name={icon} />
                {label}
                {role === "chair" && slug === "documents" && (
                  <span className="nav-count">
                    {data.documents.filter((d) => d.committeeId === committeeId).length}
                  </span>
                )}
              </Link>
            </Fragment>
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
            <div>
              <strong>{roleInfo.name}</strong>
              <small>{access.status === "active" ? "Signed in" : "Demo access"}</small>
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
            {role === "chair" ? (
              <select
                aria-label="Select committee"
                value={committeeId}
                onChange={(e) => setCommitteeId(e.target.value)}
              >
                {activeCommittees.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.room}
                  </option>
                ))}
              </select>
            ) : (
              <strong>Conference-wide</strong>
            )}
          </div>
        </header>
        <main className="workspace-content">
          {section !== "health" && <StatusStrip />}
          {section !== "health" && role === "chair" && committee && <PhotoReminderBanner committeeId={committeeId} sessionId={session?.id || ""} prominent={section === ""} />}
          {section !== "health" && role === "chair" &&
            data.sessions.filter((s) => s.committeeId === committeeId && !s.archived).length >
              0 && (
              <div className="session-selector">
                <label>
                  Current session
                  <select
                    aria-label="Current session"
                    value={session?.id || ""}
                    onChange={(e) => {if(e.target.value) void act({type:"currentSession",committeeId,sessionId:e.target.value},"chair");}}
                  >
                    <option value="">Select current session{suggestedSession?` · suggested ${suggestedSession.name}`:""}</option>
                    {data.sessions
                      .filter((s) => s.committeeId === committeeId && !s.archived)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
          {section === "health" ? <SystemHealth /> : role === "chair" ? (
            !committee ? <Panel title="No active committee"><p>No active committee is currently available for this workspace. Executive staff can check committee access and archived records.</p></Panel> : section === "photos" ? (
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
            section === "access-codes" ? <AccessCodes /> : section === "submissions" ? <SubmissionLinks /> : section === "schedule" ? <CentralSessions /> : section === "amendment-links" ? <AmendmentLinks /> : section === "photos" ? <PhotoSchedule /> : <AdminScreen section={section} />
          )}
        </main>
        <footer className="workspace-footer">
          Conference OS{" "}
          <span>
            Illustrative DCMUN-inspired data · <DataModeLabel />
          </span>
        </footer>
      </div>
    </div>
  );
}
