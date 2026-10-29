import {createHash} from 'node:crypto';
// Fixtures for the synthetic-cleanup tests: a conference with EVERY conference-scoped table populated (public and private).
// Deterministic ids from (tag, n). `revoked` leaves no active access; `active` adds one active grant, credential and link each.
export const uid=(tag:string,n:string|number)=>{const h=createHash('sha256').update(`${tag}:${n}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;};
const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
const doc=(tag:string,n:number)=>`${tag}`.replace(/[^A-Za-z0-9]/g,'').padEnd(8,'x')+createHash('sha256').update(`${tag}${n}`).digest('hex').slice(0,24);
export interface FixtureOptions{name:string;venue?:string;sharedUser?:string;features?:Record<string,unknown>;active?:'grant'|'credential'|'submission link'|'amendment link';expiredUnrevoked?:boolean;storage?:boolean}
/** The ids used by the fixture, so tests can name them. */
export const fixtureIds=(tag:string)=>({conference:uid(tag,'conference'),committee:uid(tag,'committee-a'),committee2:uid(tag,'committee-b'),session:uid(tag,'session'),userChair:uid(tag,'user-chair'),userExec:uid(tag,'user-exec'),userDevice:uid(tag,'user-device')});
export function populateSql(tag:string,o:FixtureOptions){
 const u=(n:string|number)=>q(uid(tag,n));const ids=fixtureIds(tag);const C=q(ids.conference);
 const shared=o.sharedUser?q(o.sharedUser):u('user-exec');
 return `
insert into auth.users(id) values (${u('user-chair')}),(${u('user-exec')}),(${u('user-device')}),(${u('user-staff')}) on conflict do nothing;
insert into auth.users(id) values (${shared}) on conflict do nothing;
insert into public.conferences(id,name,venue,date,features) values (${C},${q(o.name)},${q(o.venue??'Development only')},'2026-10-05',${q(JSON.stringify(o.features??{}))}::jsonb);
insert into public.schools(id,conference_id,name) values (${u('school-a')},${C},'School A'),(${u('school-b')},${C},'School B');
insert into public.conference_session_slots(id,conference_id,name,"startsAt") values (${u('slot')},${C},'Slot 1','2026-10-06T09:00:00Z');
insert into public.committees(id,conference_id,code,name,room) values (${u('committee-a')},${C},'GA1','Committee A','R1'),(${u('committee-b')},${C},'WHO','Committee B','R2');
insert into public.sessions(id,conference_id,committee_id,name,"startsAt",state) values (${u('session')},${C},${u('committee-a')},'Session 1','2026-10-06T09:00:00Z','active'),(${u('session-b')},${C},${u('committee-b')},'Session B','2026-10-06T09:00:00Z','active');
update public.committees set "currentSessionId"=${u('session')} where id=${u('committee-a')};
insert into public.delegates(id,conference_id,committee_id,"schoolId",country,name,email) values (${u('del-1')},${C},${u('committee-a')},${u('school-a')},'France','Delegate 1','d1-${tag}@example.com'),(${u('del-2')},${C},${u('committee-a')},${u('school-b')},'Japan','Delegate 2','d2-${tag}@example.com');
insert into public.staff(id,conference_id,name,auth_user_id,email,"schoolId") values (${u('staff-1')},${C},'Staff 1',${u('user-staff')},'s1-${tag}@example.com',${u('school-a')});
insert into public.committee_staff(id,conference_id,committee_id,staff_id) values (${u('cs-1')},${C},${u('committee-a')},${u('staff-1')});
insert into public.conference_staff(id,conference_id,staff_id,role) values (${u('cf-1')},${C},${u('staff-1')},'chair');
insert into public.photo_list_epochs(conference_id,committee_id,school_id,epoch) values (${C},${u('committee-b')},${u('school-b')},1) on conflict do nothing;
insert into public.photo_slots(id,conference_id,school_id,starts_at,location) values (${u('photo-slot')},${C},${u('school-a')},'2026-10-06T12:00:00Z','Hall');
insert into public.photo_acknowledgements(id,conference_id,committee_id,slot_id,stage,slot_revision,actor_id,epoch,chairs) values (${u('ack')},${C},${u('committee-a')},${u('photo-slot')},'warning',1,${u('user-chair')},1,'');
insert into public.documents(id,conference_id,committee_id,"sessionId","submitterId",code,title) values (${u('doc')},${C},${u('committee-a')},${u('session')},${u('del-1')},'GA1/${tag.slice(0,6)}-01','Resolution ${tag}');
insert into public.document_versions(id,conference_id,committee_id,"documentId",number,"createdBy","fileName","storageKey",text) values (${u('ver')},${C},${u('committee-a')},${u('doc')},1,${u('user-chair')},'resolution.pdf',${q(`${ids.conference}/${ids.committee}/${uid(tag,'doc')}/resolution.pdf`)},'text');
insert into public.document_comments(id,conference_id,committee_id,"documentId",text,"authorId") values (${u('comment')},${C},${u('committee-a')},${u('doc')},'Looks fine',${u('user-chair')});
insert into public.document_decisions(id,conference_id,committee_id,"documentId",decision,round,"versionId","versionNumber","reviewerId","reviewerName","commentId") values (${u('decision')},${C},${u('committee-a')},${u('doc')},'review_started',1,${u('ver')},1,${u('user-chair')},'Reviewer',${u('comment')});
insert into public.resolution_links(document_id,conference_id,committee_id,working_doc_id,approval_copy_doc_id,access) values (${u('doc')},${C},${u('committee-a')},${q(doc(tag,1))},${q(doc(tag,2))},'ok');
insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,state) values (${u('speech-1')},${C},${u('committee-a')},${u('session')},${u('del-1')},${u('doc')},'Main Submitter','finished');
insert into public.amendments(id,conference_id,committee_id,"resolutionId","sessionId","submitterId",type,clause,wording) values (${u('amend')},${C},${u('committee-a')},${u('doc')},${u('session')},${u('del-1')},'Add','1','Add words');
insert into public.speeches(id,conference_id,committee_id,"sessionId","delegateId","resolutionId",classification,"yieldedFrom","amendmentId") values (${u('speech-2')},${C},${u('committee-a')},${u('session')},${u('del-2')},${u('doc')},'Co-Submitter',${u('speech-1')},${u('amend')});
insert into public.poi_queue(id,conference_id,committee_id,"speechId","delegateId","position") values (${u('poi')},${C},${u('committee-a')},${u('speech-1')},${u('del-2')},1);
insert into public.participation_events(id,conference_id,committee_id,"delegateId","categoryId",points,"sessionId","resolutionId","chairId","speechId") values (${u('event')},${C},${u('committee-a')},${u('del-1')},'speech',3,${u('session')},${u('doc')},${u('user-chair')},${u('speech-1')});
insert into public.participation_corrections(id,conference_id,committee_id,event_id,points,actor_id) values (${u('corr')},${C},${u('committee-a')},${u('event')},2,${u('user-chair')});
insert into public.participation_adjustments(id,conference_id,committee_id,"delegateId","sessionId",points,reason,"chairId","chairName") values (${u('adj-1')},${C},${u('committee-a')},${u('del-1')},${u('session')},2,'bonus points',${u('user-chair')},'Chair');
insert into public.participation_adjustments(id,conference_id,committee_id,"delegateId","sessionId",points,reason,"chairId","chairName",reverses) values (${u('adj-2')},${C},${u('committee-a')},${u('del-1')},${u('session')},-2,'reverse bonus',${u('user-chair')},'Chair',${u('adj-1')});
insert into public.attendance(id,conference_id,committee_id,"delegateId","sessionId",status) values (${u('att')},${C},${u('committee-a')},${u('del-1')},${u('session')},'Present');
insert into private.conference_settings(conference_id) values (${C});
insert into public.schedule_version(id,conference_id,committee_id,effective_from,changed_by,reason,automation_enabled,sessions) values (${u('sched')},${C},${u('committee-a')},now(),${u('user-exec')},'Fixture',true,'[]');
insert into public.session_override(id,conference_id,scope,committee_id,session_id,set_by,set_at) values (${u('ovr-1')},${C},'committee',${u('committee-a')},${u('session')},${u('user-exec')},now());
insert into public.session_override(id,conference_id,scope,slot_id,targets,set_by,set_at) values (${u('ovr-2')},${C},'conference',${u('slot')},'{}'::jsonb,${u('user-exec')},now());
insert into public.session_override_end(id,conference_id,override_id,committee_id,ended_at,ended_reason) values (${u('ovr-end')},${C},${u('ovr-1')},${u('committee-a')},now(),'automation_enabled');
insert into public.roll_call(id,revision,conference_id,committee_id,state,observed_at,local_committed_at,server_committed_at,time_confidence,created_by) values (${u('rc')},1,${C},${u('committee-a')},'committed',now(),now(),now(),'trusted',${u('user-chair')});
insert into public.roll_call_row(roll_call_id,revision,conference_id,committee_id,delegate_id,status) values (${u('rc')},1,${C},${u('committee-a')},${u('del-1')},'Present');
insert into public.record_label(record_table,record_id,conference_id,committee_id,displayed_label,assigned_label) values ('speeches',${u('speech-1')},${C},${u('committee-a')},${u('session')},${u('session')});
insert into public.label_correction(id,conference_id,committee_id,record_table,record_id,corrected_label,reason,corrected_by) values (${u('lcorr')},${C},${u('committee-a')},'speeches',${u('speech-1')},null,'Fixture',${u('user-exec')});
insert into public.held_action(id,conference_id,committee_id,device_id,device_seq,actor_id,requested_role,command,payload_hash,reason) values (${u('held')},${C},${u('committee-a')},${u('device')},1,${u('user-chair')},'chair','{}','hash','uncertain_time');
insert into public.device_clock_sync(conference_id,device_id,actor_id,conference_day,offset_ms) values (${C},${u('device')},${u('user-chair')},'2026-10-06',0);
insert into public.clock_confirmation(id,conference_id,device_id,offset_ms,reason,confirmed_by) values (${u('cclock')},${C},${u('device')},0,'Fixture',${u('user-exec')});
insert into public.speaker_queue(id,conference_id,committee_id,"delegateId","sessionId","position") values (${u('queue')},${C},${u('committee-a')},${u('del-1')},${u('session')},1);
insert into public.timers(id,conference_id,committee_id,"sessionId",duration,remaining) values (${u('timer')},${C},${u('committee-a')},${u('session')},60,60);
insert into public.debate_states("sessionId",conference_id,committee_id) values (${u('session')},${C},${u('committee-a')});
insert into public.votes(id,conference_id,committee_id,"delegateId","sessionId","resolutionId",choice) values (${u('vote')},${C},${u('committee-a')},${u('del-1')},${u('session')},${u('doc')},'For');
insert into public.award_criteria(id,conference_id,committee_id,name,description,max) values (${u('crit')},${C},${u('committee-a')},'Diplomacy','desc',10);
insert into public.award_scores(id,conference_id,committee_id,"delegateId","criterionId",score,"chairId") values (${u('score')},${C},${u('committee-a')},${u('del-1')},${u('crit')},7,${u('user-chair')});
insert into public.scoring_definitions(id,conference_id,committee_id,code,label,values) values (${u('scoring')},${C},${u('committee-a')},'speech','Speech',array[1,2,3]);
insert into public.submission_links(id,conference_id,committee_id,token,share_with,created_by,revoked_at) values (${u('sublink')},${C},${u('committee-a')},${q(doc(tag,3))},'everyone',${u('user-exec')},now());
insert into public.amendment_links(id,conference_id,committee_id,token,revoked_at) values (${u('amdlink')},${C},${u('committee-a')},${q(doc(tag,4))},now());
insert into private.resolution_submissions(id,conference_id,committee_id,link_id,document_id,google_doc_id,request_payload) values (${u('rsub')},${C},${u('committee-a')},${u('sublink')},${u('doc')},${q(doc(tag,5))},'{}');
insert into private.amendment_submissions(id,link_id,amendment_id,payload) values (${u('asub')},${u('amdlink')},${u('amend')},'{}');
insert into public.user_access(id,conference_id,user_id,role,committee_id,expires_at,revoked_at) values (${u('ua-chair')},${C},${u('user-chair')},'chair',${u('committee-a')},now()+interval '1 day',now()),(${u('ua-exec')},${C},${shared},'admin',null,now()+interval '1 day',now());
insert into private.access_credentials(id,conference_id,committee_id,role,credential_hash,expires_at,revoked_at,created_by) values (${u('cred')},${C},${u('committee-a')},'chair',${q(createHash('sha256').update(tag+'cred').digest('hex'))},now()+interval '1 day',now(),${u('user-exec')});
insert into private.access_grant_sources(user_access_id,credential_id) values (${u('ua-chair')},${u('cred')});
insert into private.access_redemption_attempts(conference_id,user_id,success) values (${C},${u('user-device')},true);
insert into private.mutation_receipts(id,conference_id,actor_id,payload) values (${u('receipt')},${C},${u('user-chair')},'{}');
insert into public.audit_log(id,conference_id,committee_id,"actorId",action,"entityId",mutation_id,details) values (${u('audit')},${C},${u('committee-a')},${u('user-chair')},'test',${u('doc')},${u('mutation-1')},'{}');
insert into public.operational_changes(id,conference_id,committee_id,topic,mutation_id) values (${u('opchange')},${C},${u('committee-a')},'chair',${u('mutation-2')});
${o.storage?`insert into storage.buckets(id,name,public) values ('resolutions','resolutions',false) on conflict do nothing;
insert into storage.objects(bucket_id,name) values ('resolutions',${q(`${ids.conference}/${ids.committee}/${uid(tag,'doc')}/resolution.pdf`)}),('resolutions',${q(`${ids.conference}/${ids.committee}/${uid(tag,'doc')}/orphan.pdf`)});`:''}
${o.active==='grant'?`insert into public.user_access(id,conference_id,user_id,role,committee_id,expires_at) values (${u('ua-live')},${C},${u('user-device')},'chair',${u('committee-a')},now()+interval '1 hour');`:''}
${o.active==='credential'?`insert into private.access_credentials(id,conference_id,committee_id,role,credential_hash,expires_at) values (${u('cred-live')},${C},${u('committee-a')},'chair',${q(createHash('sha256').update(tag+'live').digest('hex'))},now()+interval '1 hour');`:''}
${o.active==='submission link'?`insert into public.submission_links(id,conference_id,committee_id,token,share_with) values (${u('sublink-live')},${C},${u('committee-a')},${q(doc(tag,6))},'everyone');`:''}
${o.active==='amendment link'?`insert into public.amendment_links(id,conference_id,committee_id,token) values (${u('amdlink-live')},${C},${u('committee-a')},${q(doc(tag,7))});`:''}
${o.expiredUnrevoked?`insert into public.user_access(id,conference_id,user_id,role,committee_id,expires_at) values (${u('ua-expired')},${C},${u('user-device')},'observer',null,now()-interval '1 hour');
insert into private.access_credentials(id,conference_id,committee_id,role,credential_hash,expires_at) values (${u('cred-expired')},${C},null,'logistics',${q(createHash('sha256').update(tag+'expired').digest('hex'))},now()-interval '1 hour');`:''}
`;
}
