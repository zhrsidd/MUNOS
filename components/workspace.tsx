"use client";
import Link from "next/link";
import { PLATFORM } from "@/lib/brand";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConference } from "@/lib/context";
import type { Role } from "@/lib/domain";
import { soleWorkspacePath } from "@/lib/access";
import { Panel } from "./ui";
import { Brand } from "./brand";
import { WorkspaceHome } from "./workspace-home";
import { workspaces as roles } from "@/lib/workspaces";
import { WorkspaceLoading } from "./workspace-loading";
import { Tabs } from "./shell";
import { navigationFor } from "@/lib/navigation";
import { ChairScreen } from "./chair";
import { Documents, Approval, Logistics } from "./documents";
import { SystemHealth, SaveStatus, DataModeLabel } from "./health";
import { AdminScreen } from "./admin";
import { SubmissionLinks, SubmissionQrPanel } from "./operations/submission-links";
import { AccessCodes } from "./access-codes";
import { CentralSessions } from "./central-sessions";
import { HeldNotice, HeldReview } from "./held-actions";
import { RollCallPrompt, SessionLabel, useCommitteeSession } from "./session-status";
import { AmendmentLinks } from "./amendments/links";
import { ChairPhotos, PhotoReminderBanner } from "./operations/photo-reminders";
import { PhotoSchedule } from "./operations/photo-schedule";
import { DelegateSubmissions } from "./operations/resolution-links";
import { FelixHelper } from "./felix-helper";
export function Workspace({ path }: { path: string }) {
  const {
    data,
    committeeId: requestedCommitteeId,
    setCommitteeId,
    access,
  } = useConference();
  const router = useRouter();
  // A staff member with exactly one workspace goes straight in; the picker is only for people with a choice.
  const soleWorkspace = !path ? soleWorkspacePath(access) : null;
  useEffect(() => { if (soleWorkspace) router.replace(soleWorkspace); }, [soleWorkspace, router]);
  const role = (path.split("/")[0] || "chair") as Role;
  const section = path.split("/")[1] || "";
  const activeCommittees = data.committees.filter(c => !c.archived && (!(role==='chair') || access.status!=='active' || access.committeeIds.includes(c.id)));
  const availableRoles = access.status === "active" ? access.roles : roles.map(r => r.id);
  const committee =
    activeCommittees.find((c) => c.id === requestedCommitteeId) ||
    activeCommittees.find(c=>c.code === "GA1") || activeCommittees[0];
  const committeeId = committee?.id ?? "";
  const { session } = useCommitteeSession(committeeId);
  // While access is still loading the picker would flash every workspace, including ones this person cannot enter.
  if (soleWorkspace || (!path && access.status === "loading")) return <WorkspaceLoading/>;
  if (!path) return <WorkspaceHome conference={data.conference} availableRoles={availableRoles} demo={access.status === "demo"} />;
  const roleInfo = roles.find((r) => r.id === role)!;
  const items = navigationFor(role);
  const canSwitch = access.status !== "active" || access.roles.length > 1;
  return (
    <div className="assembly">
      <header className="masthead">
        <div className="masthead-inner">
          <Brand />
          <div className="masthead-right">
            <span className="workspace-name">{roleInfo.name}</span>
            {canSwitch && (
              <Link href="/" className="masthead-link">
                Switch workspace
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="context-band">
        <div className="context-inner">
          {role === "chair" ? (
            <>
              <label className="context-committee">
                <span className="sr-only">Committee</span>
                <select aria-label="Select committee" value={committeeId} onChange={(e) => setCommitteeId(e.target.value)}>
                  {activeCommittees.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className="context-secondary">
                {committee ? `Room ${committee.room.replace(/^Room\s+/i, "")}` : ""}
                {committee ? <> · <SessionLabel committeeId={committeeId} /></> : null}
              </span>
            </>
          ) : (
            <>
              <strong>{roleInfo.name}</strong>
              <span className="context-secondary">Conference-wide</span>
            </>
          )}
        </div>
      </div>
      <div className="workspace-header">
      <Tabs items={items} role={role} section={section} count={role === "chair" ? { documents: data.documents.filter((d) => d.committeeId === committeeId).length } : undefined} />
      <SaveStatus />
      </div>
      <div className="main-shell">
        <main className="workspace-content">
          {section !== "health" && role === "chair" && committee && <HeldNotice committeeId={committeeId} />}
          {section !== "health" && role === "chair" && committee && <PhotoReminderBanner committeeId={committeeId} prominent={section === ""} />}
          {section !== "health" && role === "chair" && committee && section !== "roll-call" && <RollCallPrompt committeeId={committeeId} />}
          {section === "health" ? <SystemHealth /> : role === "chair" ? (
            !committee ? <Panel title="No active committee"><p>No active committee is currently available for this workspace. Executive staff can check committee access and archived records.</p></Panel> : section === "photos" ? (
              <ChairPhotos committeeId={committeeId} />
            ) : section === "documents" ? (
              <>
                <DelegateSubmissions committeeId={committeeId} />
                <Documents
                  key={committeeId}
                  committeeId={committeeId}
                />
                <SubmissionQrPanel committeeId={committeeId} />
              </>
            ) : (
              <ChairScreen
                key={committeeId}
                section={section}
                committeeId={committeeId}
              />
            )
          ) : role === "approval" ? (
            <Approval section={section} />
          ) : role === "logistics" ? (
            <Logistics section={section} />
          ) : (
            section === "access-codes" ? <AccessCodes /> : section === "submissions" ? <SubmissionLinks /> : section === "schedule" ? <CentralSessions /> : section === "held" ? <HeldReview /> : section === "amendment-links" ? <AmendmentLinks /> : section === "photos" ? <PhotoSchedule /> : <AdminScreen section={section} />
          )}
        </main>
        <footer className="workspace-footer">
          {PLATFORM.name} · Created by {PLATFORM.creator} · <Link href="/about">About</Link>{" "}
          <span>
            Illustrative DCMUN-inspired data · <DataModeLabel />
          </span>
        </footer>
      </div>
      <FelixHelper key={`${role}:${role === "chair" ? committeeId : "conference"}`} role={role} committeeId={role === "chair" ? committeeId : undefined} committeeCode={committee?.code} sessionName={session?.name} />
    </div>
  );
}
