import type {ConferenceData,ParticipationEvent} from '../domain';
import type {Lane} from './types';
// Pure procedural reads shared by the Debate Console and the local procedure engine, so the
// button a Chair sees and the rule the command enforces cannot drift apart.
export function activeLane(d:Pick<ConferenceData,'debateStates'>,sessionId:string):Lane{
 const state=d.debateStates?.find(s=>s.sessionId===sessionId);
 return (state?.mode??'open')==='open'?'open':state!.phase;
}
export function laneEntries(d:Pick<ConferenceData,'queue'>,sessionId:string,lane:Lane){
 return d.queue.filter(q=>q.sessionId===sessionId&&(q.lane??'open')===lane).sort((a,b)=>a.position-b.position);
}
/** The only speaker `Next speaker` may recognize: position 1 of the active lane. */
export function nextSpeaker(d:Pick<ConferenceData,'queue'|'debateStates'>,sessionId:string){return laneEntries(d,sessionId,activeLane(d,sessionId))[0];}
export function poiEntries(d:Pick<ConferenceData,'poiQueue'>,speechId:string){
 return (d.poiQueue??[]).filter(p=>p.speechId===speechId).sort((a,b)=>a.position-b.position);
}
/** The recognized POI awaiting its score, if any. */
export function activePoi(d:Pick<ConferenceData,'poiQueue'>,speechId:string){return poiEntries(d,speechId).find(p=>p.recognizedAt);}
/** The only POI `Next POI` may recognize: the first raised placard while no POI is active. */
export function nextPoi(d:Pick<ConferenceData,'poiQueue'>,speechId:string){return activePoi(d,speechId)?undefined:poiEntries(d,speechId)[0];}
/** The amendment currently In Debate for this committee's resolution in debate. */
export function activeAmendment(d:Pick<ConferenceData,'amendments'|'documents'>,committeeId:string){
 const resolution=d.documents.find(r=>r.committeeId===committeeId&&r.status==='In Debate');
 return resolution?d.amendments?.find(a=>a.committeeId===committeeId&&a.resolutionId===resolution.id&&a.status==='In Debate'):undefined;
}
/** Amendment context of a participation event, through the speech it belongs to. */
export function eventAmendmentId(d:Pick<ConferenceData,'speeches'>,e:ParticipationEvent){
 return e.speechId?d.speeches?.find(s=>s.id===e.speechId)?.amendmentId??null:null;
}
export const FLOOR_NOT_WITH_CHAIR='Finish the current speech and return the floor to the Chair first.';
/** True while someone has the floor (a speech or its POIs) in the amendment's session or the committee's
 *  current session. An amendment may not start, nor close once In Debate, until the floor is with the Chair. */
export function amendmentFloorTaken(d:Pick<ConferenceData,'speeches'|'committees'>,a:{committeeId:string;sessionId:string}){
 const current=d.committees.find(c=>c.id===a.committeeId)?.currentSessionId;
 return !!d.speeches?.some(s=>s.state!=='finished'&&(s.sessionId===a.sessionId||s.sessionId===current));
}
