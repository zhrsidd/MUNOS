export interface ConferenceSessionSlot {id:string;name:string;startsAt:string;endsAt:string|null;archived:boolean;revision:number}
export interface AmendmentLink {id:string;committeeId:string;token:string;createdAt:string}
export type AmendmentStatus='Submitted'|'Accepted for Debate'|'In Debate'|'Closed';
export type AmendmentOutcome='Passed'|'Failed'|'Withdrawn'|'Ruled Out';
export interface Amendment {id:string;committeeId:string;resolutionId:string;sessionId:string;submitterId:string;type:'Add'|'Strike'|'Replace';clause:string;wording:string;status:AmendmentStatus;outcome:AmendmentOutcome|null;createdAt:string;revision:number}
export interface BatchData {sessionSlots?:ConferenceSessionSlot[];amendmentLinks?:AmendmentLink[];amendments?:Amendment[]}
export type BatchCommand=
 | {type:'committeeUpdate';id:string;code:string;name:string;room:string}
 | {type:'committeeLifecycle';id:string;action:'archive'|'delete'}
 | {type:'sessionSlot';action:'create'|'update';id?:string;name:string;startsAt:string;endsAt:string|null}
 | {type:'sessionSlot';action:'archive'|'delete';id:string}
 | {type:'amendmentLink';action:'create'|'rotate'|'revoke';committeeId:string;token?:string}
 | {type:'amendmentStatus';id:string;status:AmendmentStatus;outcome?:AmendmentOutcome|null};
export const batchTypes=['committeeUpdate','committeeLifecycle','sessionSlot','amendmentLink','amendmentStatus'];
export const isBatchCommand=(c:{type:string}):c is BatchCommand=>batchTypes.includes(c.type);
