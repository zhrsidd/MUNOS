export type SpeechKind = 'Main Submitter' | 'Co-Submitter' | 'For' | 'Against' | 'Other';
export type Lane = 'open' | 'for' | 'against';
export interface DebateState { sessionId: string; mode: 'open' | 'closed'; phase: 'for' | 'against'; revision: number }
/** amendmentId: the amendment In Debate when the speech began (the parent resolution stays in resolutionId). */
export interface Speech { id: string; sessionId: string; delegateId: string; resolutionId: string | null; amendmentId?: string | null; classification: SpeechKind; yieldedFrom: string | null; state: 'speaking' | 'pois' | 'finished'; poiLimit: number | null; poiCount: number; revision: number; createdAt: string }
/** recognizedAt: set when the Chair gives this POI the floor; it stays queued until scored or withdrawn. */
export interface PoiEntry { id: string; speechId: string; delegateId: string; position: number; recognizedAt?: string | null }
export type ProcedureCommand =
 | {type:'currentSession'; committeeId:string; sessionId:string}
 | {type:'debateMode'; sessionId:string; mode:'open'|'closed'; phase:'for'|'against'}
 | {type:'queueAdd'; sessionId:string; delegateId:string; lane:Lane}
 | {type:'queueOrder'; sessionId:string; lane:Lane; ids:string[]}
 | {type:'queueRemove'; sessionId:string; entryId:string}
 | {type:'speechStart'; sessionId:string; delegateId:string; resolutionId:string|null; classification:Exclude<SpeechKind,'Co-Submitter'>; entryId?:string; amendmentId?:string|null}
 | {type:'speechYield'; sessionId:string; speechId:string; delegateId:string}
 | {type:'speechScore'; sessionId:string; speechId:string; points:number}
 | {type:'speechFinish'; sessionId:string; speechId:string}
 | {type:'poiAllowance'; sessionId:string; speechId:string; limit:number|null}
 | {type:'poiAdd'; sessionId:string; speechId:string; delegateId:string}
 | {type:'poiOrder'; sessionId:string; speechId:string; ids:string[]}
 /** Gives the first POI the floor without points. `points` only appears on legacy saved actions. */
 | {type:'poiRecognize'; sessionId:string; speechId:string; entryId:string; points?:number}
 | {type:'poiScore'; sessionId:string; speechId:string; entryId:string; points:number}
 | {type:'poiRemove'; sessionId:string; speechId:string; entryId:string}
 | {type:'voteMode'; sessionId:string; resolutionId:string; mode:'normal'|'divide'; voteType:'substantive'|'procedural'}
 | {type:'vetoRules'; committeeId:string; enabled:boolean; delegateIds:string[]};
export const procedureTypes = ['currentSession','debateMode','queueAdd','queueOrder','queueRemove','speechStart','speechYield','speechScore','speechFinish','poiAllowance','poiAdd','poiOrder','poiRecognize','poiScore','poiRemove','voteMode','vetoRules'];
export const isProcedureCommand = (c:{type:string}):c is ProcedureCommand => procedureTypes.includes(c.type);
