'use client';
import {useCallback,useEffect,useState} from 'react';
import {useConference} from '@/lib/context';
import {browserClient} from '@/lib/supabase/client';
import {listAccessCodes,rotateAccessCode,revokeAccessCode,type AccessCodeStatus} from '@/lib/access-codes';
import {STAFF_ROLE_LABELS} from '@/lib/access';
import type {Role} from '@/lib/domain';
import {PageHeading,Panel,Modal,Chip} from './ui';
import {sessionInputTime,sessionSlotFields} from './central-session-fields';
export function AccessCodes(){
 const {data,access}=useConference();const [entries,setEntries]=useState<AccessCodeStatus[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const [expiry,setExpiry]=useState(()=>sessionInputTime(new Date(Date.now()+7*86400000).toISOString()));
 const [secret,setSecret]=useState<{code:string;scope:string}|null>(null),[copied,setCopied]=useState(false);
 const [revoking,setRevoking]=useState<AccessCodeStatus|null>(null),[devices,setDevices]=useState(false);
 const conf=data.conference.id,cloud=access.status==='active';
 const refresh=useCallback(async()=>{if(!cloud)return;setEntries(await listAccessCodes(browserClient(),conf));setLoaded(true);setError('');},[cloud,conf]);
 useEffect(()=>{if(!cloud)return;let cancelled=false;void listAccessCodes(browserClient(),conf).then(rows=>{if(!cancelled){setEntries(rows);setLoaded(true);}},()=>{if(!cancelled)setError('Unable to load access-code status. Retry when connected.');});return()=>{cancelled=true;};},[cloud,conf]);
 const scopes:{role:Role;committeeId:string|null;label:string}[]=[...data.committees.filter(c=>!c.archived).map(c=>({role:'chair' as const,committeeId:c.id,label:`Chair · ${c.code}`})),...(['approval','logistics','admin'] as const).map(role=>({role,committeeId:null,label:STAFF_ROLE_LABELS[role]}))];
 async function rotate(scope:typeof scopes[number]){setBusy(true);setError('');setSecret(null);setCopied(false);try{const at=sessionSlotFields("Access code",expiry,"").startsAt;const code=await rotateAccessCode(browserClient(),conf,scope.role,scope.committeeId,at);setSecret({code,scope:scope.label});await refresh();}catch(e){setError(e instanceof Error?e.message:'Unable to create code.');}finally{setBusy(false);}}
 async function revoke(){if(!revoking)return;setBusy(true);setError('');setSecret(null);try{await revokeAccessCode(browserClient(),conf,revoking.id,devices);setRevoking(null);await refresh();}catch(e){setError(e instanceof Error?e.message:'Unable to revoke code.');}finally{setBusy(false);}}
 return <><PageHeading eyebrow="EXECUTIVE" title="Staff access codes" description="Prepare staff devices with scoped access. Codes are displayed once; device grants and RLS remain authoritative."/>
 {!cloud?<Panel title="Cloud access required"><p className="panel-body">Access codes are available in an authorized cloud workspace. The local demo does not issue real codes.</p></Panel>:<>
 <Panel title="Code expiry" subtitle="All times are Qatar time (UTC+03:00). Rotating blocks future redemption of the previous code; existing devices keep their grants until expiry or explicit revocation."><div className="panel-body"><label>New code expires<input aria-label="New code expiry" type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label><button disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh status</button></div></Panel>
 <Panel title="Access by workspace"><div className="table-scroll"><table><thead><tr><th>Scope</th><th>Status</th><th>Expiry</th><th>Actions</th></tr></thead><tbody>{scopes.map(scope=>{const entry=entries.find(e=>e.role===scope.role&&e.committeeId===scope.committeeId);return <tr key={scope.role+scope.committeeId}><td>{scope.label}</td><td><Chip tone={entry?.active?'green':'neutral'}>{entry?.active?'Active':entry?.revokedAt?'Revoked':entry?'Expired':'Not created'}</Chip></td><td>{entry?new Date(entry.expiresAt).toLocaleString('en-GB',{timeZone:'Asia/Qatar'}):'—'}</td><td><div className="actions"><button disabled={busy||!loaded} onClick={()=>{if(!entry?.active||window.confirm(`Rotate ${scope.label}? The previous code cannot be used again.`))void rotate(scope);}}>{entry?'Rotate':'Create'}</button>{entry&&<button disabled={busy||!loaded} onClick={()=>{setRevoking(entry);setDevices(false);}}>Revoke</button>}</div></td></tr>;})}</tbody></table></div></Panel>
 </>}
 {error&&<p role="alert">{error}</p>}
 {secret&&<Modal title={`${secret.scope} · copy this code now`} onClose={()=>setSecret(null)}><p>This code cannot be recovered after closing this dialog or reloading. Share it only with the intended staff.</p><input autoComplete="off" readOnly aria-label="New access code" value={secret.code} onFocus={e=>e.currentTarget.select()}/><div className="actions"><button onClick={()=>void navigator.clipboard.writeText(secret.code).then(()=>setCopied(true),()=>setError('Copy failed. Select and copy the displayed code manually.'))}>{copied?'Copied':'Copy code'}</button><button onClick={()=>setSecret(null)}>Done</button></div></Modal>}
 {revoking&&<Modal title="Revoke access code" onClose={()=>!busy&&setRevoking(null)}><p>This prevents new devices from redeeming this code.</p><label><input type="checkbox" checked={devices} onChange={e=>setDevices(e.target.checked)}/> Also revoke devices using this code</label><p className="muted">Revoked devices are blocked when they reconnect/check access. Saved pending changes remain on those devices for recovery.</p><div className="actions"><button className="primary" disabled={busy} onClick={()=>void revoke()}>Revoke code</button><button disabled={busy} onClick={()=>setRevoking(null)}>Cancel</button></div></Modal>}
 </>;
}
