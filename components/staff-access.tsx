'use client';
import {useState} from 'react';
import {repository} from '../lib/repository-instance';
import {NO_CONFERENCE_ACCESS,STAFF_ROLE_LABELS,type StaffAccess} from '../lib/access';

export function StaffAccessGate({access}:{access:StaffAccess}){
 const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[exported,setExported]=useState(false);
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Unable to continue. Please retry.');}finally{setBusy(false);}}
 async function exportSaved(){const json=await repository.exportRecovery();if(!json||json==='undefined')throw Error('No saved recovery data was found for this account.');const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='munos-staff-recovery.json';try{a.click();await repository.confirmRecoveryExport(json);setExported(true);}finally{URL.revokeObjectURL(url);}}
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:'24px',background:'var(--bg)'}}><section className="panel" style={{maxWidth:460,width:'100%',padding:32}} aria-labelledby="staff-access-title">
 <p className="eyebrow">DCMUN · MUNOS staff</p><h1 id="staff-access-title">{access.status==='signedOut'?'Enter staff access code':access.status==='loading'?'Opening your workspace':access.status==='noAccess'?'Conference access':'Connection needed'}</h1>
 <p className="muted">{access.status==='noAccess'?NO_CONFERENCE_ACCESS:access.message??'Checking your staff session and conference access…'}</p>
 {(access.status==='signedOut'||access.status==='noAccess'||access.status==='unavailable')&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{const entered=code;setCode('');await repository.redeemCode(entered);});}} style={{display:'grid',gap:16,marginTop:24}}>
 <label>Staff access code<input type="password" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={100} required value={code} onChange={e=>setCode(e.target.value)} /></label>
 <button className="button primary" disabled={busy} type="submit">{busy?'Checking access…':'Open staff workspace'}</button><p className="muted small">Use the code provided by the Executive team. A device identity is created only when you submit a code. Delegates use their committee QR form without an account.</p></form>}
 {access.status!=='loading'&&access.status!=='signedOut'&&<><p className="small muted">{access.email}</p><div className="button-row"><button className="button primary" disabled={busy} onClick={()=>void run(repository.retryAccess)}>Retry access</button><button className="button" disabled={busy} onClick={()=>void run(()=>repository.signOut())}>Sign out</button></div>{access.actorId&&<div style={{marginTop:24}}><p className="small muted">Saved changes are kept on this device. Export recovery data before changing devices; the file may contain personal information.</p><button className="button" disabled={busy} onClick={()=>void run(exportSaved)}>Export saved changes</button>{exported&&<div role="status" style={{marginTop:16}}><p className="small">Recovery download started. Keep the file safe. These actions belong to the old device identity and cannot automatically sync under a new identity. Signing out keeps the saved checkpoint on this device.</p><button className="button danger" disabled={busy} onClick={()=>void run(()=>repository.signOut(true))}>Sign out after recovery export</button></div>}</div>}</>}
 {error&&<p role="alert" style={{marginTop:16}}>{error}</p>}
 </section></main>;
}
export function StaffAccessStatus({access}:{access:StaffAccess}){
 const [error,setError]=useState('');
 if(access.status!=='active')return null;
 return <aside aria-label="Staff account" style={{display:'flex',flexWrap:'wrap',alignItems:'center',gap:12,padding:'8px 24px',borderBottom:'1px solid var(--line)',background:'var(--surface)'}}>
 <span className="small">{access.roles.map(role=>STAFF_ROLE_LABELS[role]).join(' · ')}</span><span className="muted small" style={{flex:1}}>{access.email}</span><button className="button small" onClick={()=>void repository.signOut().catch(e=>setError(e.message))}>Sign out</button>{error&&<span role="alert">{error}</span>}
 </aside>;
}
