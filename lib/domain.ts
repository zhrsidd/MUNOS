import type {BatchData} from './batch/types';
import type { DebateState, Speech, PoiEntry, Lane, SpeechKind } from "./procedure/types";
export type ID = string;
export type Role = "chair" | "approval" | "logistics" | "admin";
export type AttendanceStatus = "Present" | "Present & Voting" | "Absent";
export const stages = [
  "Draft",
  "Submitted",
  "Review",
  "Approved",
  "Printed",
  "In Debate",
  "Closed",
] as const;
export type DocumentStatus = (typeof stages)[number];
export interface Conference {
  votingRule?: "simple_majority" | "two_thirds";
  id: ID;
  name: string;
  venue: string;
  date: string;
  features: Record<string, boolean>;
}
export interface ScoringDefinition {
  id: ID;
  label: string;
  values: number[];
}
export interface Committee {
  archived?: boolean;
  revision?: number;
  currentSessionId?: ID | null;
  sessionRevision?: number;
  vetoEnabled?: boolean;
  vetoDelegateIds?: ID[];
  votingRule?: "simple_majority" | "two_thirds";
  id: ID;
  conferenceId: ID;
  code: string;
  name: string;
  room: string;
  scoringOverrides?: ScoringDefinition[];
}
export interface School {
  id: ID;
  name: string;
}
export interface Delegate {
  id: ID;
  committeeId: ID;
  schoolId: ID;
  country: string;
  flag: string;
  name: string;
  email: string;
}
export interface Staff {
  /** Directory contact, not an authentication identity. Published only for assigned Chairs. */
  email?: string | null;
  contactRevision?: number;
  /** A Chair's school, so they are included in that school's group photo. Executive-only data. */
  schoolId?: ID | null;
  id: ID;
  name: string;
  role: Role;
  committeeIds: ID[];
}
export interface Session {
  slotId?: string | null;
  archived?: boolean;
  id: ID;
  committeeId: ID;
  name: string;
  startsAt: string;
  /** CODEX REVIEW REQUIRED: optional end time, set by schedule import (sessions."endsAt"). */
  endsAt?: string | null;
  state: "scheduled" | "active" | "closed";
}
export interface Attendance {
  revision?: number;
  id: ID;
  delegateId: ID;
  sessionId: ID;
  status: AttendanceStatus;
  updatedAt: string;
}
export interface AccessCredential {
  id: ID;
  conferenceId: ID;
  credentialHash: string;
  expiresAt: string;
  role: Role;
}
export interface UserAccess {
  id: ID;
  staffId: ID;
  role: Role;
  committeeIds: ID[];
  expiresAt: string;
}
export interface DocumentVersion {
  id: ID;
  documentId: ID;
  number: number;
  createdAt: string;
  createdBy: ID;
  fileName: string;
  storageKey: string | null;
  text: string;
}
export interface Resolution {
  voteMode?: "normal" | "divide";
  voteType?: "substantive" | "procedural";
  vetoedBy?: ID[];
  revision?: number;
  id: ID;
  committeeId: ID;
  sessionId: ID | null;
  code: string;
  title: string;
  submitterId: ID;
  /**
   * The Main Submitter's country, published by the server (private.document_submitter_countries) to readers whose
   * snapshot carries no delegates (Approval, Logistics). Country only; null/absent when not published or unreadable.
   * The identity formatter uses it only when the submitter's delegate cannot be found.
   */
  submitterCountry?: string | null;
  status: DocumentStatus;
  outcome?: "Passed" | "Failed" | "Withdrawn";
  /** "observed": the Chair declared a clear majority; no country choices or totals were recorded. */
  outcomeMethod?: "counted" | "observed";
  declaredBy?: ID | null;
  /** The declaring Chair's staff name, when the server could resolve one. */
  declaredByName?: string | null;
  declaredAt?: string | null;
  versionIds: ID[];
  copies: number;
  comments: { id: ID; text: string; authorId: ID; createdAt: string }[];
}
export interface ParticipationEvent {
  speechId?: ID;
  classification?: SpeechKind;
  yieldedFrom?: ID | null;
  revision?: number;
  id: ID;
  delegateId: ID;
  categoryId: ID;
  points: number;
  createdAt: string;
  /** Legacy: the session a Chair had selected when the event was recorded. New events carry none; the server's label gives the session. */
  sessionId?: ID | null;
  committeeId?: ID;
  resolutionId: ID | null;
  chairId: ID;
  voidedAt?: string;
  updatedAt?: string;
}
/** Live state is keyed by committee (docs/SESSION_MODEL.md section 8): a live row has committeeId and no sessionId. A row with a
 *  sessionId was written under the old session-keyed model and is history. */
export interface SpeakerQueueEntry {
  lane?: Lane;
  id: ID;
  delegateId: ID;
  committeeId?: ID;
  sessionId?: ID | null;
  position: number;
}
export interface Vote {
  revision?: number;
  id: ID;
  resolutionId: ID;
  committeeId?: ID;
  sessionId?: ID | null;
  delegateId: ID;
  choice: "For" | "Against" | "Abstain";
  createdAt: string;
}
/** A committed roll call revision (section 6). Drafts stay on the device; the server only ever sees a whole commit. */
export interface RollCall {
  id: ID;
  revision: number;
  committeeId: ID;
  copiedFrom?: ID | null;
  observedAt: string;
  committedAt: string;
  /** Device commit time when the server trusted it, otherwise server receipt. Live presence is the roll call with the latest one. */
  effectiveAt: string;
  timeConfidence?: "trusted" | "uncertain" | null;
  legacy?: boolean;
  rows: { delegateId: ID; status: AttendanceStatus }[];
}
/** A ballot's eligibility snapshot, taken when the ballot opened. Every vote on the resolution is checked against it. */
export interface BallotEntry { resolutionId: ID; delegateId: ID; status: AttendanceStatus; committeeId?: ID }
export interface AwardCriterion {
  committeeId?: ID | null;
  id: ID;
  name: string;
  description: string;
  max: number;
}
export interface AwardScore {
  id: ID;
  delegateId: ID;
  criterionId: ID;
  score: number;
  chairId: ID;
  notes: string;
}
export interface AuditEntry {
  id: ID;
  actorId: ID;
  action: string;
  entityId: ID;
  createdAt: string;
}
export interface TimerState {
  revision?: number;
  duration: number;
  remaining: number;
  startedAt: number | null;
}
import type { OperationsData } from "./operations/types";
// CODEX REVIEW REQUIRED: OperationsData adds optional, extension-owned fields only.
export interface ConferenceData extends OperationsData, BatchData {
  debateStates?: DebateState[];
  speeches?: Speech[];
  rollCalls?: RollCall[];
  ballots?: BallotEntry[];
  poiQueue?: PoiEntry[];
  conference: Conference;
  committees: Committee[];
  schools: School[];
  delegates: Delegate[];
  staff: Staff[];
  sessions: Session[];
  attendance: Attendance[];
  documents: Resolution[];
  versions: DocumentVersion[];
  events: ParticipationEvent[];
  queue: SpeakerQueueEntry[];
  votes: Vote[];
  scoring: ScoringDefinition[];
  criteria: AwardCriterion[];
  awardScores: AwardScore[];
  audit: AuditEntry[];
  /** Deprecated: the speaker timer is local to the device. The server still returns this until the schema owner removes its table; the client ignores it. */
  timers?: Record<ID, TimerState>;
}
export interface DocumentStorageAdapter {
  upload(file: File, documentId: ID): Promise<{ storageKey: string }>;
  signedUrl(storageKey: string): Promise<string>;
}
export const roleCapabilities: Record<Role, string[]> = {
  chair: [
    "attendance",
    "participation",
    "queue",
    "voting",
    "documents",
  ],
  approval: ["review"],
  logistics: ["printing"],
  admin: ["configuration", "import", "audit"],
};
