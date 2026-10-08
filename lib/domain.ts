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
  status: DocumentStatus;
  outcome?: "Passed" | "Failed" | "Withdrawn";
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
  sessionId: ID;
  resolutionId: ID | null;
  chairId: ID;
  voidedAt?: string;
  updatedAt?: string;
}
export interface SpeakerQueueEntry {
  lane?: Lane;
  id: ID;
  delegateId: ID;
  sessionId: ID;
  position: number;
}
export interface Vote {
  revision?: number;
  id: ID;
  resolutionId: ID;
  sessionId: ID;
  delegateId: ID;
  choice: "For" | "Against" | "Abstain";
  createdAt: string;
}
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
  timers: Record<ID, TimerState>;
}
export interface DocumentStorageAdapter {
  upload(file: File, documentId: ID): Promise<{ storageKey: string }>;
  signedUrl(storageKey: string): Promise<string>;
}
export interface ArchiveAdapter {
  mirror(version: DocumentVersion): Promise<{ archiveId: string }>;
}
export const roleCapabilities: Record<Role, string[]> = {
  chair: [
    "attendance",
    "participation",
    "queue",
    "voting",
    "documents",
    "awards",
  ],
  approval: ["review"],
  logistics: ["printing"],
  admin: ["configuration", "import", "audit"],
};
