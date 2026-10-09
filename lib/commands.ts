import {applyBatch,materializeCommitteeSessions} from './batch/commands';
import {isBatchCommand,type BatchCommand} from './batch/types';
import {applyProcedure} from "./procedure/commands";
import {isProcedureCommand, type ProcedureCommand} from "./procedure/types";
import {
  AttendanceStatus,
  ConferenceData,
  DocumentStatus,
  Role,
  Vote,
} from "./domain";
import { applyOperationsCommand, isOperationsCommand, operationsRoles, type OperationsCommand } from "./operations/commands";
import { conferenceScoring, scoringProblem, scoringValues } from "./scoring";
import { countryFlag } from "./countries";
export { effectiveScoring } from "./scoring";
// CODEX REVIEW REQUIRED: extension commands (OperationsCommand) join the union and are
// delegated to lib/operations; core command handling is unchanged.
export type Command =
  | BatchCommand
  | OperationsCommand
  | ProcedureCommand
  | {
      type: "attendance";
      delegateId: string;
      sessionId: string;
      status: AttendanceStatus;
    }
  | {
      type: "participation";
      delegateId: string;
      categoryId: string;
      points: number;
      sessionId: string;
      resolutionId: string | null;
    }
  | { type: "event"; id: string; points?: number; undo?: boolean }
  | {
      type: "document";
      id: string;
      status: DocumentStatus;
      comment?: string;
      outcome?: "Passed" | "Failed" | "Withdrawn";
    }
  | { type: "version"; id: string; fileName: string; text: string }
  | {
      type: "newDocument";
      committeeId: string;
      sessionId: string;
      title: string;
      submitterId: string;
    }
  | { type: "queue"; delegateId?: string; sessionId: string; advance?: boolean }
  | {
      type: "vote";
      delegateId: string;
      sessionId: string;
      resolutionId: string;
      choice: Vote["choice"];
    }
  | {
      type: "timer";
      sessionId: string;
      remaining: number;
      startedAt: number | null;
      duration: number;
    }
  | {
      type: "committee";
      code: string;
      name: string;
      room: string;
      override?: boolean;
    }
  | {
      type: "delegate";
      id: string;
      name: string;
      email: string;
      country: string;
      /** Derived from country by the client (lib/countries); never typed by staff. */
      flag?: string;
    }
  | {
      type: "import";
      rows: {
        name: string;
        country: string;
        email: string;
        schoolId: string;
        committeeId: string;
        flag?: string;
      }[];
    }
  | { type: "conference"; name: string; venue: string; date: string }
  | { type: "feature"; name: string; enabled: boolean }
  | { type: "scoring"; id: string; values: number[]; committeeId?: string }
  | {
      type: "criterion";
      id: string;
      name: string;
      description: string;
      max: number;
    }
  | {
      type: "award";
      delegateId: string;
      criterionId: string;
      score: number;
      notes: string;
    }
  | { type: "session"; committeeId: string; name: string }
  | { type: "school"; name: string }
  | { type: "staff"; name: string; role: Role; committeeIds: string[]; email?: string }
  | { type: "staffContact"; id: string; email: string };
export interface ConferenceRepository {
  getSnapshot(): ConferenceData | null;
  subscribe(listener: () => void): () => void;
  initialize(): void;
  execute(command: Command, role: Role): Promise<void>;
  reset(): void;
}
const id = () => crypto.randomUUID();
export function participationSummary(data: ConferenceData, delegateId: string) {
  const events = data.events.filter(
    (e) => e.delegateId === delegateId && !e.voidedAt,
  );
  return {
    opportunities: events.filter(e=>e.categoryId!=="submitter").length,
    points: events.reduce((n, e) => n + e.points, 0),
    speeches: events.filter((e) => e.categoryId === "speech").length,
  };
}
export function suggestedDelegates(data: ConferenceData, sessionId: string) {
  const committeeId = data.sessions.find(
    (s) => s.id === sessionId,
  )?.committeeId;
  return data.delegates
    .filter(
      (d) =>
        d.committeeId === committeeId &&
        data.attendance.some(
          (a) =>
            a.delegateId === d.id &&
            a.sessionId === sessionId &&
            a.status !== "Absent",
        ) &&
        !data.queue.some(
          (q) => q.delegateId === d.id && q.sessionId === sessionId,
        ),
    )
    .sort(
      (a, b) =>
        participationSummary(data, a.id).opportunities -
          participationSummary(data, b.id).opportunities ||
        a.country.localeCompare(b.country),
    );
}
const allowed: Record<Command["type"], Role[]> = {
  attendance: ["chair"],
  participation: ["chair"],
  event: ["chair"],
  document: ["chair", "approval", "logistics"],
  version: ["chair"],
  newDocument: ["chair"],
  queue: ["chair"],
  vote: ["chair"],
  timer: ["chair"],
  committee: ["admin"],
  delegate: ["admin"],
  import: ["admin"],
  conference: ["admin"],
  feature: ["admin"],
  scoring: ["admin"],
  criterion: ["admin"],
  award: ["chair"],
  session: ["admin"],
  school: ["admin"],
  staff: ["admin"],
  staffContact: ["admin"],
  ...operationsRoles,
  committeeUpdate:["admin"],committeeLifecycle:["admin"],sessionSlot:["admin"],amendmentLink:["admin"],amendmentStatus:["chair"],
  currentSession:["chair"], debateMode:["chair"], queueAdd:["chair"], queueOrder:["chair"], queueRemove:["chair"], speechStart:["chair"], speechYield:["chair"], speechScore:["chair"], speechFinish:["chair"], poiAllowance:["chair"], poiAdd:["chair"], poiOrder:["chair"], poiRecognize:["chair"], poiScore:["chair"], poiRemove:["chair"], voteMode:["chair"], vetoRules:["admin"],
};
export function applyCommand(
  previous: ConferenceData,
  c: Command,
  role: Role,
  metadata?: { id: string; createdAt: string; actorId?: string },
): ConferenceData {
  if (!allowed[c.type].includes(role))
    throw Error("This action is outside the demo role boundary.");
  let sequence = 0;
  const nextId = () => metadata ? `${metadata.id.slice(0, 24)}${(++sequence).toString(16).padStart(12, "0")}` : id();
  const d = structuredClone(previous),
    now = metadata?.createdAt ?? new Date().toISOString();
  if ("sessionId" in c) {
    const session = d.sessions.find((s) => s.id === c.sessionId);
    if (!session) throw Error("Choose a valid session.");
    if (
      "delegateId" in c &&
      c.delegateId &&
      !d.delegates.some(
        (x) => x.id === c.delegateId && x.committeeId === session.committeeId,
      )
    )
      throw Error("Delegate is outside this committee.");
    if (
      "resolutionId" in c &&
      c.resolutionId &&
      !d.documents.some(
        (r) => r.id === c.resolutionId && r.committeeId === session.committeeId,
      )
    )
      throw Error("Resolution is outside this committee.");
  }
  switch (c.type) {
    case "attendance": {
      const a = d.attendance.find(
        (a) => a.delegateId === c.delegateId && a.sessionId === c.sessionId,
      );
      if (a) {
        a.revision = (a.revision ?? 0) + 1;
        a.status = c.status;
        a.updatedAt = now;
      } else
        d.attendance.push({
          id: nextId(),
          delegateId: c.delegateId,
          sessionId: c.sessionId,
          status: c.status,
          revision: 1,
          updatedAt: now,
        });
      d.votes = d.votes.filter(
        (v) =>
          d.documents.find(r=>r.id===v.resolutionId)?.status === "Closed" ||
          v.delegateId !== c.delegateId ||
          v.sessionId !== c.sessionId ||
          (c.status !== "Absent" &&
            (c.status !== "Present & Voting" || v.choice !== "Abstain")),
      );
      if (c.status === "Absent")
        d.queue = d.queue.filter(
          (q) => q.delegateId !== c.delegateId || q.sessionId !== c.sessionId,
        );
      break;
    }
    case "participation": {
      if(c.categoryId==="submitter" && (!c.resolutionId || d.documents.find(r=>r.id===c.resolutionId)?.submitterId!==c.delegateId || d.events.some(e=>e.categoryId==="submitter" && e.resolutionId===c.resolutionId))) throw Error("Main Submitter credit requires a resolution and may only be recorded once.");
      const committeeId = d.sessions.find((s) => s.id === c.sessionId)?.committeeId ?? "";
      if (!scoringValues(d, committeeId, c.categoryId).includes(c.points))
        throw Error("Choose a configured point value.");
      d.events.push({
        id: nextId(),
        delegateId: c.delegateId,
        categoryId: c.categoryId,
        points: c.points,
        sessionId: c.sessionId,
        resolutionId: c.resolutionId,
        chairId: metadata?.actorId ?? "chair-demo",
        createdAt: now,
      });
      break;
    }
    case "event": {
      const e = d.events.find((e) => e.id === c.id);
      if (e) {
        e.revision = (e.revision ?? 0) + 1;
        if (c.undo) e.voidedAt = now;
        else {
          const committeeId = d.sessions.find((s) => s.id === e.sessionId)?.committeeId ?? "";
          if (!scoringValues(d, committeeId, e.categoryId).includes(c.points ?? -1))
            throw Error("Invalid points.");
          e.points = c.points!;
          e.updatedAt = now;
        }
      }
      break;
    }
    case "document": {
      const r = d.documents.find((r) => r.id === c.id);
      if (!r) throw Error("Resolution not found.");
      const transitions: Record<DocumentStatus, DocumentStatus[]> = {
        Draft: ["Submitted"],
        Submitted: ["Review", "Approved", "Draft"],
        Review: ["Approved", "Draft"],
        Approved: ["Printed"],
        Printed: ["In Debate"],
        "In Debate": ["Closed"],
        Closed: [],
      };
      if (!transitions[r.status].includes(c.status))
        throw Error("Invalid workflow transition.");
      if (
        role === "approval" &&
        !(
          ["Submitted", "Review"].includes(r.status) &&
          ["Review", "Approved", "Draft"].includes(c.status)
        )
      )
        throw Error("Approval role can only review submissions.");
      if (
        role === "logistics" &&
        !(r.status === "Approved" && c.status === "Printed")
      )
        throw Error("Logistics can only mark approved documents printed.");
      if (
        role === "chair" &&
        !["Submitted", "In Debate", "Closed"].includes(c.status)
      )
        throw Error("Chair action not permitted.");
      if (c.status === "Closed" && !c.outcome)
        throw Error("Choose an outcome.");
      if (c.status === "Draft" && !c.comment?.trim())
        throw Error("A change request needs a review comment.");
      if (
        c.status === "In Debate" &&
        d.documents.some(
          (x) => x.committeeId === r.committeeId && x.status === "In Debate",
        )
      )
        throw Error(
          "Close the current debate before opening another resolution.",
        );
      r.revision = (r.revision ?? 0) + 1;
      if(c.status==='Closed' && c.outcome!=='Withdrawn') {
        const eligible=d.attendance.filter(a=>a.sessionId===r.sessionId && a.status!=='Absent');
        const ballots=d.votes.filter(v=>v.sessionId===r.sessionId && v.resolutionId===r.id);
        if(!eligible.length || ballots.length!==eligible.length)throw Error('Record every eligible ballot before closing.');
        if(c.outcome!==votingOutcome(d,r.id))throw Error('Outcome differs from configured voting rule.');
      }
      if(c.status==="In Debate") {const current=d.committees.find(x=>x.id===r.committeeId)?.currentSessionId;if(current)r.sessionId=current;}
      r.status = c.status;
      r.outcome = c.outcome;
      if(c.status === "Closed") r.vetoedBy=c.outcome==="Withdrawn"?[]:vetoDelegates(d,r.id);
      if (c.comment)
        r.comments.push({
          id: nextId(),
          text: c.comment,
          authorId: metadata?.actorId ?? `${role}-demo`,
          createdAt: now,
        });
      break;
    }
    case "version": {
      const r = d.documents.find((r) => r.id === c.id);
      if (!r || r.status !== "Draft")
        throw Error("New versions require a draft.");
      const versionId = nextId();
      d.versions.push({
        id: versionId,
        documentId: r.id,
        number: r.versionIds.length + 1,
        createdAt: now,
        createdBy: metadata?.actorId ?? "chair-demo",
        fileName: c.fileName,
        storageKey: null,
        text: c.text,
      });
      r.versionIds.push(versionId);
      r.revision = (r.revision ?? 0) + 1;
      break;
    }
    case "newDocument": {
      if (
        !d.delegates.some(
          (x) => x.id === c.submitterId && x.committeeId === c.committeeId,
        )
      )
        throw Error("Select a main submitter in this committee.");
      const documentId = nextId(),
        versionId = nextId();
      d.documents.push({
        id: documentId,
        committeeId: c.committeeId,
        sessionId: c.sessionId,
        code: `${d.committees.find((x) => x.id === c.committeeId)?.code} / ${String(d.documents.filter((r) => r.committeeId === c.committeeId).length + 1).padStart(2, "0")}`,
        title: c.title,
        submitterId: c.submitterId,
        status: "Draft",
        revision: 1,
        versionIds: [versionId],
        copies: 24,
        comments: [],
      });
      d.versions.push({
        id: versionId,
        documentId,
        number: 1,
        createdAt: now,
        createdBy: metadata?.actorId ?? "chair-demo",
        fileName: "draft-preview.txt",
        storageKey: null,
        text: c.title + "\n\nDraft document. Add a mock version to continue.",
      });
      break;
    }
    case "queue": {
      if (
        c.delegateId &&
        !d.attendance.some(
          (a) =>
            a.sessionId === c.sessionId &&
            a.delegateId === c.delegateId &&
            a.status !== "Absent",
        )
      )
        throw Error("Only present delegates may join the queue.");
      const q = d.queue
        .filter((q) => q.sessionId === c.sessionId)
        .sort((a, b) => a.position - b.position);
      if (c.advance && q[0]) {
        d.queue = d.queue.filter((x) => x.id !== q[0].id);
        const duration = d.timers[c.sessionId]?.duration || 90;
        d.timers[c.sessionId] = {
          revision: (d.timers[c.sessionId]?.revision ?? 0) + 1,
          duration,
          remaining: duration,
          startedAt: null,
        };
      } else if (c.delegateId && !q.some((x) => x.delegateId === c.delegateId))
        d.queue.push({
          id: nextId(),
          sessionId: c.sessionId,
          delegateId: c.delegateId,
          position: (q.at(-1)?.position ?? -1) + 1,
        });
      break;
    }
    case "vote": {
      const a = d.attendance.find(
        (a) => a.delegateId === c.delegateId && a.sessionId === c.sessionId,
      );
      if(c.choice==="Abstain" && d.documents.find(r=>r.id===c.resolutionId)?.voteMode==="divide") throw Error("Divide the House does not permit abstentions.");
      if (
        !a ||
        a.status === "Absent" ||
        (a.status === "Present & Voting" && c.choice === "Abstain")
      )
        throw Error("Attendance does not permit this vote.");
      if (
        d.documents.find((r) => r.id === c.resolutionId)?.status !== "In Debate"
      )
        throw Error("Voting requires a resolution in debate.");
      const revision = (d.votes.find(v=>v.delegateId===c.delegateId && v.sessionId===c.sessionId && v.resolutionId===c.resolutionId)?.revision ?? 0) + 1;
      d.votes = d.votes.filter(
        (v) =>
          !(
            v.delegateId === c.delegateId &&
            v.resolutionId === c.resolutionId &&
            v.sessionId === c.sessionId
          ),
      );
      d.votes.push({ id: nextId(), ...c, createdAt: now, revision });
      break;
    }
    case "timer":
      d.timers[c.sessionId] = {
        revision: (d.timers[c.sessionId]?.revision ?? 0) + 1,
        remaining: c.remaining,
        startedAt: c.startedAt,
        duration: c.duration,
      };
      break;
    case "committee":
      if (!c.code.trim() || d.committees.some((x) => x.code === c.code.trim()))
        throw Error("Use a unique committee code.");
      d.committees.push({
        id: nextId(),
        conferenceId: d.conference.id,
        code: c.code.trim(),
        name: c.name,
        room: c.room,
        revision: 1, archived: false,
      });
      materializeCommitteeSessions(d,d.committees[d.committees.length-1].id,nextId);
      break;
    case "delegate": {
      const delegate = d.delegates.find((x) => x.id === c.id);
      if (delegate)
        Object.assign(delegate, {
          name: c.name,
          email: c.email,
          country: c.country,
          flag: countryFlag(c.country),
        });
      break;
    }
    case "import": {
      const emails = new Set(d.delegates.map((x) => x.email.toLowerCase()));
      for (const row of c.rows) {
        if (
          !row.name.trim() ||
          !row.country.trim() ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ||
          emails.has(row.email.toLowerCase())
        )
          throw Error("Import contains invalid or duplicate delegate records.");
        if (
          !d.committees.some((x) => x.id === row.committeeId) ||
          !d.schools.some((x) => x.id === row.schoolId)
        )
          throw Error("Choose a valid committee and school.");
        emails.add(row.email.toLowerCase());
      }
      c.rows.forEach((row) =>
        d.delegates.push({ id: nextId(), ...row, flag: countryFlag(row.country) }),
      );
      break;
    }
    case "conference":
      Object.assign(d.conference, {
        name: c.name,
        venue: c.venue,
        date: c.date,
      });
      break;
    case "feature":
      d.conference.features[c.name] = c.enabled;
      break;
    case "scoring": {
      const problem = scoringProblem(c.id, c.values);
      if (problem) throw Error(problem);
      const base = conferenceScoring(d).find((s) => s.id === c.id);
      if (!base) throw Error("Unknown scoring category.");
      const definition = { id: c.id, label: base.label, values: [...c.values] };
      if (c.committeeId) {
        const committee = d.committees.find((x) => x.id === c.committeeId);
        if (!committee) throw Error("Committee unavailable.");
        // An override replaces only this category; other categories keep inheriting.
        committee.scoringOverrides = [...(committee.scoringOverrides ?? []).filter((s) => s.id !== c.id), definition];
      } else d.scoring = d.scoring.some((s) => s.id === c.id) ? d.scoring.map((s) => (s.id === c.id ? definition : s)) : [...d.scoring, definition];
      break;
    }
    case "criterion": case "award": throw Error("Award rubrics have been retired. Awards remain Chair judgement.");
    case "session":
      d.sessions.push({
        id: nextId(),
        committeeId: c.committeeId,
        name: c.name,
        startsAt: now,
        state: "scheduled",
      });
      break;
    case "school":
      d.schools.push({ id: nextId(), name: c.name });
      break;
    case "staffContact": {
      const staff = d.staff.find(s=>s.id===c.id);
      if (!staff) throw Error("Staff member unavailable");
      staff.email = cleanStaffEmail(c.email);
      staff.contactRevision = (staff.contactRevision ?? 1) + 1;
      break;
    }
    case "staff":
      d.staff.push({
        id: nextId(),
        name: c.name,
        email: cleanStaffEmail(c.email ?? ""),
        contactRevision: 1,
        role: c.role,
        committeeIds: c.committeeIds,
      });
      break;
    default:
      if (isBatchCommand(c)) applyBatch(d,c,nextId,now);
      else if (isProcedureCommand(c)) applyProcedure(d,c,nextId,now,metadata?.actorId ?? "chair-demo");
      else if (isOperationsCommand(c)) applyOperationsCommand(d, c, nextId, now);
  }
  if (!["queue","queueAdd","queueOrder","queueRemove","poiAdd","poiOrder","poiAllowance","debateMode"].includes(c.type)) d.audit.unshift({
    id: nextId(),
    actorId: metadata?.actorId ?? `${role}-demo`,
    action:
      c.type === "document"
        ? `Resolution → ${c.status}`
        : c.type === "event" && c.undo
          ? "Participation event undone"
          : `${c.type} updated`,
    entityId:
      "id" in c
        ? (c.id ?? d.conference.id)
        : "delegateId" in c
          ? (c.delegateId ?? d.conference.id)
          : d.conference.id,
    createdAt: now,
  });
  return d;
}

export function votingOutcome(data: ConferenceData, resolutionId: string): "Passed" | "Failed" {
 const resolution=data.documents.find(r=>r.id===resolutionId);
 const votes=data.votes.filter(v=>v.resolutionId===resolutionId && v.sessionId===resolution?.sessionId);
 if(vetoDelegates(data,resolutionId).length)return "Failed";
 const yes=votes.filter(v=>v.choice==='For').length, no=votes.filter(v=>v.choice==='Against').length;
 const rule=data.committees.find(c=>c.id===resolution?.committeeId)?.votingRule ?? data.conference.votingRule ?? 'simple_majority';
 return yes+no>0 && (rule==='two_thirds'?yes*3>=(yes+no)*2:yes>no)?'Passed':'Failed';
}
export function vetoDelegates(data:ConferenceData,resolutionId:string):string[]{
 const r=data.documents.find(r=>r.id===resolutionId); if(!r)return []; if(r.status==="Closed")return r.vetoedBy??[];
 const c=data.committees.find(c=>c.id===r.committeeId);
 if(!c?.vetoEnabled || r.voteType==="procedural")return [];
 return data.votes.filter(v=>v.resolutionId===r.id && v.sessionId===r.sessionId && v.choice==="Against" && c.vetoDelegateIds?.includes(v.delegateId) && data.attendance.some(a=>a.delegateId===v.delegateId&&a.sessionId===v.sessionId&&a.status!=="Absent")).map(v=>v.delegateId);
}

function cleanStaffEmail(value: string): string | null {
  const email=value.trim();
  if (email && (email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw Error("Enter a valid contact email");
  return email || null;
}
