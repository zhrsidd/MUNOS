export type SpeechKind = 'Main Submitter' | 'Co-Submitter' | 'For' | 'Against' | 'Other';
export type Lane = 'open' | 'for' | 'against';
/** Committee-level debate state. A row with a sessionId is history from the session-keyed model. */
export interface DebateState { committeeId?: string; sessionId?: string | null; mode: 'open' | 'closed'; phase: 'for' | 'against'; revision: number }
/** amendmentId: the amendment In Debate when the speech began (the parent resolution stays in resolutionId). */
export interface Speech { id: string; committeeId?: string; sessionId?: string | null; delegateId: string; resolutionId: string | null; amendmentId?: string | null; classification: SpeechKind; yieldedFrom: string | null; state: 'speaking' | 'pois' | 'finished'; poiLimit: number | null; poiCount: number; revision: number; createdAt: string }
/** recognizedAt: set when the Chair gives this POI the floor; it stays queued until scored or withdrawn. */
export interface PoiEntry { id: string; speechId: string; delegateId: string; position: number; recognizedAt?: string | null }
export type ProcedureCommand =
 | {type:'debateMode'; committeeId:string; sessionId?:string; mode:'open'|'closed'; phase:'for'|'against'}
 | {type:'queueAdd'; committeeId:string; sessionId?:string; delegateId:string; lane:Lane}
 | {type:'queueOrder'; committeeId:string; sessionId?:string; lane:Lane; ids:string[]}
 | {type:'queueRemove'; committeeId:string; sessionId?:string; entryId:string}
 | {type:'speechStart'; committeeId:string; sessionId?:string; delegateId:string; resolutionId:string|null; classification:Exclude<SpeechKind,'Co-Submitter'>; entryId?:string; amendmentId?:string|null}
 | {type:'speechYield'; committeeId:string; sessionId?:string; speechId:string; delegateId:string}
 /** submitterPoints: the Main Submitter credit this device awarded with a Main Submitter speech score (its effective
  *  setting when the action was saved). If the credit is due but the setting has changed since, the action is refused
  *  as a retained conflict, never repriced. Absent on actions saved before the credit was configurable: they awarded +5. */
 | {type:'speechScore'; committeeId:string; sessionId?:string; speechId:string; points:number; submitterPoints?:number}
 | {type:'speechFinish'; committeeId:string; sessionId?:string; speechId:string}
 | {type:'poiAllowance'; committeeId:string; sessionId?:string; speechId:string; limit:number|null}
 | {type:'poiAdd'; committeeId:string; sessionId?:string; speechId:string; delegateId:string}
 | {type:'poiOrder'; committeeId:string; sessionId?:string; speechId:string; ids:string[]}
 /** Gives the first POI the floor without points. `points` only appears on legacy saved actions. */
 | {type:'poiRecognize'; committeeId:string; sessionId?:string; speechId:string; entryId:string; points?:number}
 | {type:'poiScore'; committeeId:string; sessionId?:string; speechId:string; entryId:string; points:number}
 | {type:'poiRemove'; committeeId:string; sessionId?:string; speechId:string; entryId:string}
 | {type:'voteMode'; committeeId:string; sessionId?:string; resolutionId:string; mode:'normal'|'divide'; voteType:'substantive'|'procedural'}
 | {type:'vetoRules'; committeeId:string; enabled:boolean; delegateIds:string[]};
export const procedureTypes = ['debateMode','queueAdd','queueOrder','queueRemove','speechStart','speechYield','speechScore','speechFinish','poiAllowance','poiAdd','poiOrder','poiRecognize','poiScore','poiRemove','voteMode','vetoRules'];
export const isProcedureCommand = (c:{type:string}):c is ProcedureCommand => procedureTypes.includes(c.type);
