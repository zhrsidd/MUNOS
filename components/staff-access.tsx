'use client';
import {useState} from 'react';
import {repository} from '../lib/repository-instance';
import {NO_CONFERENCE_ACCESS,STAFF_ROLE_LABELS,type StaffAccess} from '../lib/access';

export function StaffAccessGate({access}:{access:StaffAccess}){
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(action:()=>Promise<unknown>){setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:'Unable to continue. Please retry.');}finally{setBusy(false);}}
 async function exportSaved(){const json=await repository.exportRecovery();if(!json||json==='undefined')throw Error('No saved recovery data was found for this account.');const url=URL.createObjectURL(new Blob([json],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='munos-staff-recovery.json';a.click();URL.revokeObjectURL(url);}
 return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:'24px',background:'var(--bg)'}}><section className="panel" style={{maxWidth:460,width:'100%',padding:32}} aria-labelledby="staff-access-title">
 <p className="eyebrow">DCMUN · MUNOS staff</p><h1 id="staff-access-title">{access.status==='signedOut'?'Staff sign-in':access.status==='loading'?'Opening your workspace':access.status==='noAccess'?'Conference access':'Connection needed'}</h1>
 <p className="muted">{access.status==='noAccess'?NO_CONFERENCE_ACCESS:access.message??'Checking your staff session and conference access…'}</p>
 {access.status==='signedOut'&&<form onSubmit={e=>{e.preventDefault();void run(async()=>{await repository.signIn(email,password);setPassword('');});}} style={{display:'grid',gap:16,marginTop:24}}>
 <label>Staff email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label>
 <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label>
 <button className="button primary" disabled={busy} type="submit">{busy?'Signing in…':'Sign in'}</button><p className="muted small">Use the staff account provided by the Executive team. Delegates submit documents using their committee QR code.</p></form>}
 {access.status!=='loading'&&access.status!=='signedOut'&&<><p className="small muted">{access.email}</p><div className="button-row"><button className="button primary" disabled={busy} onClick={()=>void run(repository.retryAccess)}>Retry access</button><button className="button" disabled={busy} onClick={()=>void run(repository.signOut)}>Sign out</button></div>{access.actorId&&<div style={{marginTop:24}}><p className="small muted">Saved changes are kept on this device. Export recovery data before changing devices; the file may contain personal information.</p><button className="button" disabled={busy} onClick={()=>void run(exportSaved)}>Export saved changes</button></div>}</>}
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
