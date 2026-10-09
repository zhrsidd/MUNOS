import type {ConferenceData, ParticipationEvent} from '../domain';
import type {ProcedureCommand, Speech} from './types';
import {activeAmendment,activeLane,laneEntries,poiEntries} from './view';
import {MAIN_SUBMITTER_POINTS,scoringValues} from '../scoring';
export function applyProcedure(d:ConferenceData,c:ProcedureCommand,nextId:()=>string,now:string,actor:string){
 const committee=d.committees.find(x=>x.id===('committeeId' in c?c.committeeId:d.sessions.find(s=>s.id===c.sessionId)?.committeeId));
 if(!committee)throw Error('Committee unavailable.');
 const sid='sessionId' in c?c.sessionId:'';
 const present=(id:string)=>d.attendance.some(a=>a.sessionId===sid&&a.delegateId===id&&a.status!=='Absent');
 const requirePresent=(id:string)=>{if(!present(id))throw Error('Delegate must be present.');};
 const speeches=d.speeches??=[]; const pois=d.poiQueue??=[];
 const speech='speechId' in c?speeches.find(s=>s.id===c.speechId&&s.sessionId===sid):undefined;
 const active=()=>{if(!speech||speech.state==='finished')throw Error('This speech has finished.');return speech;};
 const reorder=(entries:{id:string;position:number}[],ids:string[])=>{if(ids.length!==entries.length||new Set(ids).size!==ids.length||ids.some(id=>!entries.some(e=>e.id===id)))throw Error('Queue changed. Review its current order.');ids.forEach((id,i)=>{entries.find(e=>e.id===id)!.position=i;});};
 const event=(s:Speech,delegateId:string,categoryId:string,points:number)=>{const e:ParticipationEvent={id:nextId(),delegateId,categoryId,points,sessionId:sid,resolutionId:s.resolutionId,chairId:actor,createdAt:now,speechId:s.id,classification:s.classification,yieldedFrom:s.yieldedFrom};d.events.push(e);};
 switch(c.type){
 case 'currentSession':
  if(!d.sessions.some(s=>s.id===sid&&s.committeeId===committee.id))throw Error('Session outside committee.');
  committee.currentSessionId=sid;committee.sessionRevision=(committee.sessionRevision??0)+1;
  break;
 case 'vetoRules':
  if(new Set(c.delegateIds).size!==c.delegateIds.length||c.delegateIds.some(id=>!d.delegates.some(x=>x.id===id&&x.committeeId===committee.id)))throw Error('Choose delegations in this committee.');
  committee.vetoEnabled=c.enabled;committee.vetoDelegateIds=c.delegateIds;break;
 case 'debateMode': {
  const states=d.debateStates??=[];const old=states.find(s=>s.sessionId===sid);
  if(old)Object.assign(old,{mode:c.mode,phase:c.phase,revision:old.revision+1});else states.push({sessionId:sid,mode:c.mode,phase:c.phase,revision:1});break;
 }
 case 'queueAdd':
  requirePresent(c.delegateId);
  if(!d.queue.some(q=>q.sessionId===sid&&(q.lane??'open')===c.lane&&q.delegateId===c.delegateId))d.queue.push({id:nextId(),sessionId:sid,delegateId:c.delegateId,lane:c.lane,position:Math.max(-1,...d.queue.filter(q=>q.sessionId===sid&&(q.lane??'open')===c.lane).map(q=>q.position))+1});break;
 case 'queueOrder':reorder(d.queue.filter(q=>q.sessionId===sid&&(q.lane??'open')===c.lane),c.ids);break;
 case 'queueRemove':d.queue=d.queue.filter(q=>q.sessionId!==sid||q.id!==c.entryId);break;
 case 'speechStart':{
  requirePresent(c.delegateId);
  if(speeches.some(s=>s.sessionId===sid&&s.state!=='finished'))throw Error('Return the floor to the Chair first.');
  const doc=d.documents.find(r=>r.id===c.resolutionId&&r.committeeId===committee.id&&r.status==='In Debate');
  if(c.resolutionId&&!doc)throw Error('Resolution must be in debate.');
  if(c.classification==='Main Submitter'&&doc?.submitterId!==c.delegateId)throw Error('Choose this resolution’s Main Submitter.');
  if(!['Main Submitter','For','Against','Other'].includes(c.classification))throw Error('Co-Submitter requires a yield from the Main Submitter.');
  const amendment=doc?activeAmendment(d,committee.id):undefined;
  if('amendmentId' in c&&(c.amendmentId??null)!==(amendment?.id??null))throw Error('The amendment debate changed. Review the Debate Console.');
  if(amendment&&c.classification==='Main Submitter')throw Error('Main Submitter and Co-Submitter speeches belong to resolution debate, not amendment debate.');
  if(c.entryId){
   const entry=d.queue.find(q=>q.id===c.entryId&&q.sessionId===sid&&q.delegateId===c.delegateId);
   if(!entry)throw Error('Queue entry changed.');
   // Only position 1 of the active lane (open debate, or the current For/Against phase).
   const lane=entry.lane??'open';
   if(lane!==activeLane(d,sid)||laneEntries(d,sid,lane)[0]?.id!==entry.id)throw Error('The speaker queue changed. Only the first speaker in the current queue can be recognized.');
   d.queue=d.queue.filter(q=>q.id!==c.entryId);
  }
  speeches.push({id:nextId(),sessionId:sid,delegateId:c.delegateId,resolutionId:c.resolutionId,amendmentId:amendment?.id??null,classification:c.classification,yieldedFrom:null,state:'speaking',poiLimit:0,poiCount:0,revision:1,createdAt:now});break;
 }
 case 'speechYield':{
  const s=active();requirePresent(c.delegateId);
  if(s.classification!=='Main Submitter'||!s.resolutionId||s.delegateId===c.delegateId)throw Error('Only a Main Submitter may yield to a different Co-Submitter.');
  if(s.amendmentId)throw Error('Main Submitter and Co-Submitter speeches belong to resolution debate, not amendment debate.');
  s.state='finished';s.revision++;d.poiQueue=pois.filter(p=>p.speechId!==s.id);
  speeches.push({id:nextId(),sessionId:sid,delegateId:c.delegateId,resolutionId:s.resolutionId,amendmentId:s.amendmentId??null,classification:'Co-Submitter',yieldedFrom:s.id,state:'speaking',poiLimit:0,poiCount:0,revision:1,createdAt:now});break;
 }
 case 'speechScore':{
  const s=active();if(!scoringValues(d,committee.id,'speech').includes(c.points))throw Error('Choose a configured speech value.');
  if(d.events.some(e=>e.speechId===s.id&&e.categoryId==='speech'))throw Error('Speech already recorded. Edit its event in Participation.');
  event(s,s.delegateId,'speech',c.points);
  if(s.classification==='Main Submitter'&&!d.events.some(e=>e.resolutionId===s.resolutionId&&e.categoryId==='submitter'))event(s,s.delegateId,'submitter',MAIN_SUBMITTER_POINTS);
  break;
 }
 case 'speechFinish': {const s=active();s.state='finished';s.revision++;d.poiQueue=pois.filter(p=>p.speechId!==s.id);break;}
 case 'poiAllowance':{const s=active();if(c.limit!==null&&(!Number.isInteger(c.limit)||c.limit<0||c.limit>1000||c.limit<s.poiCount))throw Error('Enter a whole-number allowance at least as large as POIs already heard.');s.poiLimit=c.limit;s.state='pois';s.revision++;break;}
 case 'poiAdd':{const s=active();requirePresent(c.delegateId);if(s.delegateId===c.delegateId)throw Error('A speaker cannot ask their own POI.');if(!pois.some(p=>p.speechId===s.id&&p.delegateId===c.delegateId))pois.push({id:nextId(),speechId:s.id,delegateId:c.delegateId,position:Math.max(-1,...pois.filter(p=>p.speechId===s.id).map(p=>p.position))+1});break;}
 case 'poiOrder':active();reorder(pois.filter(p=>p.speechId===c.speechId),c.ids);break;
 case 'poiRecognize':{
  const s=active(), p=pois.find(p=>p.id===c.entryId&&p.speechId===s.id);
  if(!p)throw Error('POI already recognized or removed.');requirePresent(p.delegateId);
  if(s.state!=='pois'||(s.poiLimit!==null&&s.poiCount>=s.poiLimit))throw Error('Set or extend the POI allowance first.');
  if(pois.some(x=>x.speechId===s.id&&x.recognizedAt))throw Error('Score or withdraw the current POI first.');
  if(c.points!==undefined){
   // Legacy one-step recognition saved by an older client.
   if(!scoringValues(d,committee.id,'poi').includes(c.points))throw Error('Choose a configured POI value.');
   event(s,p.delegateId,'poi',c.points);s.poiCount++;s.revision++;d.poiQueue=pois.filter(x=>x.id!==p.id);break;
  }
  // Recognition gives the first raised placard the floor and records no points.
  if(poiEntries(d,s.id)[0]?.id!==p.id)throw Error('The POI queue changed. Only the first POI can be recognized.');
  p.recognizedAt=now;s.revision++;break;
 }
 case 'poiScore':{
  const s=active(), p=pois.find(p=>p.id===c.entryId&&p.speechId===s.id);
  if(!p?.recognizedAt)throw Error('Recognize this POI before scoring it.');
  if(!scoringValues(d,committee.id,'poi').includes(c.points))throw Error('Choose a configured POI value.');
  event(s,p.delegateId,'poi',c.points);s.poiCount++;s.revision++;d.poiQueue=pois.filter(x=>x.id!==p.id);break;
 }
 case 'poiRemove':{
  const s=active();if(!pois.some(p=>p.id===c.entryId&&p.speechId===s.id))throw Error('POI queue changed.');
  s.revision++;d.poiQueue=pois.filter(x=>x.id!==c.entryId);break;
 }
 case 'voteMode':{
  const r=d.documents.find(r=>r.id===c.resolutionId&&r.committeeId===committee.id&&r.status==='In Debate');if(!r)throw Error('Open a resolution for debate first.');
  d.votes=d.votes.filter(v=>v.resolutionId!==r.id); // Prior choices remain in audit history.
  r.voteMode=c.mode;r.voteType=c.voteType;r.sessionId=sid;r.revision=(r.revision??0)+1;break;
 }
 }
 if(['speechStart','speechYield','speechFinish'].includes(c.type)) {const old=d.timers[sid];const duration=old?.duration??90;d.timers[sid]={duration,remaining:duration,startedAt:null,revision:(old?.revision??0)+1};}

}
