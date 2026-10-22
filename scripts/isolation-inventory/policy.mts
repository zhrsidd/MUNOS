// Permission-drift POLICY (HD4). Byte-diffing docs/generated shows THAT something changed; this file decides what is never
// acceptable regardless of whether the generated files were regenerated. Pure function over the inventory model, so it can be
// unit-tested against hand-built models and run against a live disposable database. Allow-lists: policy-allowlist.json.
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export interface PolicyFn{schema:string;name:string;args:string;security:string;config:string;exec:Record<string,boolean>;publicExec:boolean}
export interface PolicyRel{schema:string;name:string;kind:string;rls:boolean;privs:Record<string,string[]>}
export interface PolicyModel{fns:PolicyFn[];rels:PolicyRel[];colAcl:{table:string;column:string;privs:Record<string,string[]>}[];defaults:{owner:string;schema:string;type:string;acl:string}[]}
export interface Allow{serviceRoleExecute:string[];authenticatedTablePrivileges:string[];viewsWithoutRls:string[];defaultAclGrantees:string[]}

export const loadAllow=():Allow=>JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),'policy-allowlist.json'),'utf8')) as Allow;
export const fnKey=(f:{schema:string;name:string;args:string})=>`${f.schema}.${f.name}(${f.args})`;

/** Returns one human-readable violation per breach; an empty array means the policy holds. */
export function evaluatePolicy(m:PolicyModel,allow:Allow=loadAllow()):string[]{
 const v:string[]=[];
 const svc=new Set(allow.serviceRoleExecute);
 for(const f of m.fns){
  const k=fnKey(f);
  if(f.publicExec)v.push(`function ${k}: EXECUTE held by PUBLIC`);
  if(f.exec.anon)v.push(`function ${k}: EXECUTE held by anon`);
  if(f.exec.service_role&&!svc.has(k))v.push(`function ${k}: EXECUTE held by service_role but not in serviceRoleExecute`);
  if(f.security==='definer'&&!/(^|, )search_path=/.test(f.config))v.push(`function ${k}: SECURITY DEFINER without a pinned search_path`);
 }
 const have=new Set(m.fns.filter(f=>f.exec.service_role).map(fnKey));
 for(const k of svc)if(!have.has(k))v.push(`allow-list entry ${k} is not a function service_role can execute (stale allow-list)`);
 const authOk=new Set(allow.authenticatedTablePrivileges);
 const noRls=new Set(allow.viewsWithoutRls);
 for(const r of m.rels){
  const k=`${r.schema}.${r.name}`;
  if(r.kind==='S'){
   for(const role of ['anon','authenticated','service_role'])if(r.privs[role]?.length)v.push(`sequence ${k}: ${role} holds ${r.privs[role].join('+')}`);
   continue;
  }
  if(r.privs.anon.length)v.push(`relation ${k}: anon (or PUBLIC) holds ${r.privs.anon.join('+')}`);
  if(r.privs.service_role.length)v.push(`relation ${k}: service_role holds ${r.privs.service_role.join('+')} (policy: none)`);
  const extra=r.privs.authenticated.filter(p=>!authOk.has(p));
  if(extra.length)v.push(`relation ${k}: authenticated holds ${extra.join('+')} beyond ${[...authOk].join('+')}`);
  if(['r','p'].includes(r.kind)){if(!r.rls)v.push(`table ${k}: row level security is not enabled`);}
  else if(!noRls.has(k))v.push(`${r.kind==='v'?'view':'relation of kind '+r.kind} ${k}: not in viewsWithoutRls (review it, then list it)`);
 }
 const known=new Set(m.rels.map(r=>`${r.schema}.${r.name}`));
 for(const c of m.colAcl){
  const k=`${c.table}.${c.column}`;
  if(c.privs.anon.length)v.push(`column ${k}: anon (or PUBLIC) holds ${c.privs.anon.join('+')}`);
  if(c.privs.service_role.length)v.push(`column ${k}: service_role holds ${c.privs.service_role.join('+')} (policy: none)`);
  const extra=c.privs.authenticated.filter(p=>!authOk.has(p));
  if(extra.length)v.push(`column ${k}: authenticated holds ${extra.join('+')} beyond ${[...authOk].join('+')}`);
 }
 for(const k of noRls)if(!known.has(k))v.push(`allow-list entry ${k} in viewsWithoutRls does not exist (stale allow-list)`);
 const grantees=new Set(allow.defaultAclGrantees);
 for(const d of m.defaults){
  if(!['public','private','(global)'].includes(d.schema))continue;
  for(const entry of d.acl.split(',')){
   const who=entry.split('=')[0]||'PUBLIC';
   if(who!==d.owner&&!grantees.has(who))v.push(`default ACL ${d.owner} ${d.schema} ${d.type}: grants to ${who} (${entry})`);
  }
 }
 return v;
}
