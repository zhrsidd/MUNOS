import type {ConferenceData} from '../domain';
import type {BatchCommand} from './types';
import {amendmentFloorTaken,FLOOR_NOT_WITH_CHAIR} from '../procedure/view';
export function batchFingerprint(d:ConferenceData,c:BatchCommand):string|null{
 if(c.type==='committeeUpdate'||c.type==='committeeLifecycle')return String(d.committees.find(x=>x.id===c.id)?.revision??1);
 if(c.type==='sessionSlot')return c.action==='create'?null:String(d.sessionSlots?.find(x=>x.id===c.id)?.revision??0);
 if(c.type==='amendmentLink')return d.amendmentLinks?.find(x=>x.committeeId===c.committeeId)?.id??'none';
 return String(d.amendments?.find(x=>x.id===c.id)?.revision??0);
}
export function materializeCommitteeSessions(d:ConferenceData,committeeId:string,nextId:()=>string){
 for(const slot of [...(d.sessionSlots??[])].filter(s=>!s.archived).sort((a,b)=>a.id.localeCompare(b.id)))d.sessions.push({id:nextId(),committeeId,slotId:slot.id,name:slot.name,startsAt:slot.startsAt,endsAt:slot.endsAt,state:'scheduled',archived:false});
}
export function sessionUsed(d:ConferenceData,id:string){return d.attendance.some(x=>x.sessionId===id)||d.documents.some(x=>x.sessionId===id)||d.events.some(x=>x.sessionId===id)||d.queue.some(x=>x.sessionId===id)||d.votes.some(x=>x.sessionId===id)||!!d.timers[id]||!!d.speeches?.some(x=>x.sessionId===id)||!!d.debateStates?.some(x=>x.sessionId===id)||!!d.amendments?.some(x=>x.sessionId===id)||d.committees.some(x=>x.currentSessionId===id);}
export function applyBatch(d:ConferenceData,c:BatchCommand,nextId:()=>string,now:string){
 if(c.type==='committeeUpdate'||c.type==='committeeLifecycle'){
  const committee=d.committees.find(x=>x.id===c.id);if(!committee)throw Error('Committee unavailable.');
  if(c.type==='committeeUpdate'){
   const code=c.code.trim(),name=c.name.trim();if(!code||code.length>30||!name||name.length>200||c.room.length>200)throw Error('Enter a committee code, name and room within the limits.');
   if(d.committees.some(x=>x.id!==c.id&&x.code===code))throw Error('Use a unique committee code.');Object.assign(committee,{code,name,room:c.room.trim()});
  }else if(c.action==='archive'){committee.archived=true;committee.currentSessionId=null;committee.sessionRevision=(committee.sessionRevision??0)+1;}
  else{
   if(d.delegates.some(x=>x.committeeId===c.id)||d.documents.some(x=>x.committeeId===c.id)||d.staff.some(x=>x.committeeIds.includes(c.id))||d.submissionLinks?.some(x=>x.committeeId===c.id)||d.amendmentLinks?.some(x=>x.committeeId===c.id)||d.sessions.some(x=>x.committeeId===c.id&&sessionUsed(d,x.id))||committee.scoringOverrides?.length)throw Error('This committee has linked records. Archive it to preserve history.');
   d.sessions=d.sessions.filter(x=>x.committeeId!==c.id);d.committees=d.committees.filter(x=>x.id!==c.id);
  }
  committee.revision=(committee.revision??1)+1;return;
 }
 if(c.type==='sessionSlot'){
  d.sessionSlots??=[];let slot=d.sessionSlots.find(x=>x.id===c.id);
  if(c.action==='create'||c.action==='update'){
   if(!c.name.trim()||c.name.trim().length>200||!Number.isFinite(Date.parse(c.startsAt))||(c.endsAt&&(!Number.isFinite(Date.parse(c.endsAt))||Date.parse(c.endsAt)<=Date.parse(c.startsAt))))throw Error('Enter a valid session name and start/end time.');
   const fields={name:c.name.trim(),startsAt:new Date(c.startsAt).toISOString(),endsAt:c.endsAt?new Date(c.endsAt).toISOString():null};
   if(c.action==='create'){
    slot={id:nextId(),...fields,archived:false,revision:1};d.sessionSlots.push(slot);
    for(const committee of [...d.committees].filter(x=>!x.archived).sort((a,b)=>a.id.localeCompare(b.id)))d.sessions.push({id:nextId(),committeeId:committee.id,slotId:slot.id,...fields,state:'scheduled',archived:false});
   }else{if(!slot||slot.archived)throw Error('Active session slot unavailable.');Object.assign(slot,fields,{revision:slot.revision+1});d.sessions.filter(s=>s.slotId===c.id).forEach(s=>Object.assign(s,fields));}
  }else{
   if(!slot)throw Error('Session slot unavailable.');const slotId=slot.id;const sessions=d.sessions.filter(x=>x.slotId===slotId);
   if(c.action==='delete'){
    if(sessions.some(s=>sessionUsed(d,s.id)))throw Error('This session has operational history. Archive it instead.');
    d.sessions=d.sessions.filter(s=>s.slotId!==slotId);d.sessionSlots=d.sessionSlots.filter(s=>s.id!==slotId);
   }else{slot.archived=true;slot.revision++;for(const s of sessions){s.archived=true;s.state='closed';}for(const committee of d.committees)if(sessions.some(s=>s.id===committee.currentSessionId)){committee.currentSessionId=null;committee.sessionRevision=(committee.sessionRevision??0)+1;}}
  }return;
 }
 if(c.type==='amendmentLink'){
  if(!d.committees.some(x=>x.id===c.committeeId&&!x.archived))throw Error('Active committee unavailable.');
  if(c.action!=='revoke'&&!/^[A-Za-z0-9_-]{22,64}$/.test(c.token??''))throw Error('Invalid amendment link.');
  const current=d.amendmentLinks?.find(x=>x.committeeId===c.committeeId);if(c.action==='create'&&current)throw Error('An amendment link already exists. Replace it instead.');
  d.amendmentLinks=(d.amendmentLinks??[]).filter(x=>x.committeeId!==c.committeeId);
  if(c.action!=='revoke')d.amendmentLinks.push({id:nextId(),committeeId:c.committeeId,token:c.token!,createdAt:now});return;
 }
 const amendment=d.amendments?.find(x=>x.id===c.id);if(!amendment)throw Error('Amendment unavailable.');
 if(!d.documents.some(x=>x.id===amendment.resolutionId&&x.status==='In Debate'))throw Error('This resolution is no longer in debate.');
 const valid=(amendment.status==='Submitted'&&c.status==='Accepted for Debate'&&!c.outcome)||(amendment.status==='Accepted for Debate'&&c.status==='In Debate'&&!c.outcome)||(amendment.status!=='Closed'&&c.status==='Closed'&&(c.outcome==='Ruled Out'||c.outcome==='Withdrawn'||(amendment.status==='In Debate'&&(c.outcome==='Passed'||c.outcome==='Failed'))));
 if(!valid)throw Error('Invalid amendment transition.');
 if(c.status==='In Debate'&&d.amendments?.some(x=>x.id!==c.id&&x.committeeId===amendment.committeeId&&x.status==='In Debate'))throw Error('Close the current amendment debate first.');
 // Procedural invariant: an amendment debate starts, and an active one closes, only with the floor at the Chair.
 if((c.status==='In Debate'||(amendment.status==='In Debate'&&c.status==='Closed'))&&amendmentFloorTaken(d,amendment))throw Error(FLOOR_NOT_WITH_CHAIR);
 Object.assign(amendment,{status:c.status,outcome:c.outcome??null,revision:amendment.revision+1});
}
