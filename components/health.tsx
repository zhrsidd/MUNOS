"use client";
import {useState,useSyncExternalStore} from 'react';
import {repository} from '@/lib/repository';
export function SystemHealth(){
 const health=useSyncExternalStore(repository.subscribe,repository.getHealth,repository.getHealth);
 const [exported,setExported]=useState(false);
 async function exportChanges(){const text=await repository.exportRecovery();if(!text)return;const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`conference-recovery-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);setExported(true);}
 return <section className="health-screen"><div className="eyebrow">ADMINISTRATOR · RECOVERY</div><h1>System health</h1><p className="muted">This device’s connection and saved changes. Keep this laptop open until its changes are synced.</p>
 <div className={`health-banner ${health.state==='conflict'||health.state==='error'?'danger':health.mode==='local'||health.state==='waiting'?'warning':'success'}`} role="status"><strong>{health.message}</strong><p>{health.mode==='local'?'Local demo only. Changes here are not sent to the conference database.':!health.realtime?'Live updates temporarily unavailable. Ordinary reads and writes can continue.':'Live updates connected.'}</p></div>
 <div className="health-grid">{[
 ['Conference database',health.mode==='supabase'?(health.state==='waiting'?'Connection interrupted':'Connected to development'):'Not connected'],
 ['Last response',health.latency===null?'Not measured':`${health.latency} ms`],['Live updates',health.realtime?'Connected':'Unavailable · automatic retry'],
 ['Changes on this device',`${health.pending} unsynced · ${health.conflicts} need review`],['Application version',process.env.NEXT_PUBLIC_APP_VERSION||'development'],
 ['PDF storage','Not configured · text previews only'],['Drive backup','Not configured · no archive copies'],['Last sync',health.lastSynced?new Date(health.lastSynced).toLocaleTimeString():'Not yet synced']
 ].map(([label,value])=><div className="panel" key={label}><span className="muted">{label}</span><h3>{value}</h3></div>)}</div>
 <div className="actions"><button className="button primary" onClick={()=>repository.retry()}>Retry connection</button><button className="button" onClick={()=>void exportChanges()}>Export device recovery file</button></div>
 <p className="muted">Recovery files contain delegate details. Give them only to the conference administrator and delete them after recovery is confirmed. Never clear browser data while changes are waiting.</p>
 {health.detail&&<details><summary>Administrator details</summary><p className="wrap-anywhere">{health.detail}</p>{health.actorId&&<p>Device user: {health.actorId}</p>}</details>}
 {repository.getPending().filter(m=>m.state==='conflict').map(m=><article className="panel" key={m.id}><h3>Review saved {m.command.type} change</h3><p>{m.message}</p><details><summary>Original saved action</summary><pre>{JSON.stringify(m.command,null,2)}</pre></details><p>Export first. Check the current conference value, then dismiss this saved action and enter the intended change again if needed.</p><button className="button" disabled={!exported} onClick={()=>{if(window.confirm('Dismiss this exported action and keep the current conference value?'))void repository.resolveConflict(m.id);}}>Keep conference value · dismiss exported action</button></article>)}
 </section>;
}
export function SyncStatus(){
 const h=useSyncExternalStore(repository.subscribe,repository.getHealth,repository.getHealth);
 return <span title={h.mode==='local'?'Local demonstration; no changes are sent to Supabase.':undefined}>{h.message}<small>{h.mode==='supabase'?'Development database': 'Local demo · cloud unavailable'}</small></span>;
}
