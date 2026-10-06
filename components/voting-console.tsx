"use client";
import {useState} from 'react';
import {useConference} from '@/lib/context';
import {vetoDelegates,votingOutcome} from '@/lib/repository';
import {Chip,DelegateIdentity,Empty,Panel} from './ui';
export function VotingConsole({committeeId,sessionId}:{committeeId:string;sessionId:string}){
 const {data,act}=useConference();const [confirm,setConfirm]=useState(false);
 const committee=data.committees.find(c=>c.id===committeeId)!;
 const r=data.documents.find(r=>r.committeeId===committeeId&&r.status==='In Debate');
 if(!r)return <Empty title="No voting in progress" text="Move a printed resolution into debate from Documents to open voting."/>;
 const attendance=data.attendance.filter(a=>a.sessionId===sessionId&&a.status!=='Absent');
 const voters=data.delegates.filter(d=>attendance.some(a=>a.delegateId===d.id));
 const votes=data.votes.filter(v=>v.resolutionId===r.id&&v.sessionId===sessionId);
 const veto=vetoDelegates(data,r.id), result=votingOutcome(data,r.id);
 const divide=r.voteMode==='divide';
 const next=voters.find(d=>!votes.some(v=>v.delegateId===d.id));
 const sessionMismatch=r.sessionId!==sessionId;
 const chooseMode=(mode:'normal'|'divide',voteType:'substantive'|'procedural')=>{if(votes.length&&!window.confirm('Start a fresh ballot? Earlier choices remain in the audit history.'))return;void act({type:'voteMode',resolutionId:r.id,sessionId,mode,voteType},'chair');};
 return <>
 <Panel title={`${r.code} · Voting procedure`} subtitle="Choose the procedure. Starting a fresh ballot preserves earlier choices in the audit history. Each eligible delegation has one vote.">
 <div className="actions"><button className={!divide?'selected':''} onClick={()=>chooseMode('normal',r.voteType??'substantive')}>Normal vote</button><button className={divide?'selected':''} onClick={()=>chooseMode('divide',r.voteType??'substantive')}>Divide the House</button><label>Vote type<select value={r.voteType??'substantive'} onChange={e=>chooseMode(r.voteMode??'normal',e.target.value as 'substantive'|'procedural')}><option value="substantive">Substantive</option><option value="procedural">Procedural · no veto</option></select></label></div>
 {sessionMismatch&&<div className="callout">This resolution’s ballot belongs to a different session. Select that session, or choose a voting mode here before recording any ballots.</div>}
 {divide&&<div className="callout"><strong>{next?`Call ${next.country}`:'Every delegation has voted'}</strong><span>Roll-call vote · For or Against only.</span></div>}
 <div className="metrics">{(['For','Against','Abstain'] as const).map(x=><div className="metric" key={x}><strong>{votes.filter(v=>v.choice===x).length}</strong><span>{x}</span></div>)}<div className="metric"><strong>{voters.length-votes.length}</strong><span>Awaiting vote</span></div></div>
 <div className="roll-list">{voters.map(d=>{const a=attendance.find(a=>a.delegateId===d.id)!;const v=votes.find(v=>v.delegateId===d.id);return <div className="roll-row" key={d.id}><div><DelegateIdentity delegate={d}/>{committee.vetoEnabled&&committee.vetoDelegateIds?.includes(d.id)&&<Chip tone="neutral">Veto-capable · substantive votes</Chip>}</div><div className="vote-controls">{(divide?['For','Against'] as const:['For','Against','Abstain'] as const).map(choice=><button key={choice} disabled={sessionMismatch||(divide&&next?.id!==d.id&&!v)||(choice==='Abstain'&&a.status==='Present & Voting')} aria-pressed={v?.choice===choice} className={v?.choice===choice?'selected':''} onClick={()=>void act({type:'vote',sessionId,resolutionId:r.id,delegateId:d.id,choice},'chair')}>{choice}</button>)}</div></div>;})}</div>
 <div className="panel-bottom"><strong>{veto.length?`FAILED — VETO: ${veto.map(id=>data.delegates.find(d=>d.id===id)?.country).join(', ')}`:`Current result: ${result}`}</strong><button className="primary" disabled={sessionMismatch||!voters.length||votes.length!==voters.length} onClick={()=>setConfirm(true)}>Close voting</button></div>
 {confirm&&<div className="callout"><p>Confirm {veto.length?'FAILED — VETO':result}. Ballots and the result remain in the conference history.</p><button className="primary" onClick={async()=>{if(await act({type:'document',id:r.id,status:'Closed',outcome:result},'chair'))setConfirm(false);}}>Confirm {result}</button><button onClick={()=>setConfirm(false)}>Keep voting open</button></div>}
 </Panel>
 </>;
}
