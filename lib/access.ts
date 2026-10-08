import type {Role} from './domain';
import type {Transport} from './sync/repository';
import type {Mutation} from './sync/store';
export const NO_CONFERENCE_ACCESS='You are signed in, but you do not currently have access to this conference.';
export const STAFF_ROLES:Role[]=['chair','approval','logistics','admin'];
export const STAFF_ROLE_LABELS:Record<Role,string>={chair:'Chair',approval:'Approval Panel',logistics:'Admins',admin:'Executive'};
export interface AccessGrant {role:Role;committee_id:string|null;expires_at:string;revoked_at?:string|null}
export interface StaffAccess {
 status:'loading'|'demo'|'signedOut'|'active'|'noAccess'|'unavailable';
 roles:Role[];committeeIds:string[];actorId?:string;email?:string;validUntil?:number;message?:string;
}
export function activeStaffGrants(rows:AccessGrant[],now=Date.now()):AccessGrant[]{
 return rows.filter(a=>STAFF_ROLES.includes(a.role)&&!a.revoked_at&&Date.parse(a.expires_at)>now&&(a.role!=='chair'||!!a.committee_id));
}
export function grantAccess(rows:AccessGrant[],actorId:string,email?:string,now=Date.now()):StaffAccess {
 const grants=activeStaffGrants(rows,now);
 if(!grants.length)return{status:'noAccess',roles:[],committeeIds:[],actorId,email,message:NO_CONFERENCE_ACCESS};
 return{status:'active',actorId,email,roles:[...new Set(grants.map(a=>a.role))],committeeIds:[...new Set(grants.filter(a=>a.role==='chair').map(a=>a.committee_id!))],validUntil:Math.min(now+48*3600000,...grants.map(a=>Date.parse(a.expires_at)))};
}
export function cachedStaffAccess(pointer:Record<string,string>|undefined,actorId:string,email?:string,now=Date.now()):StaffAccess|null {
 if(!pointer||pointer.actorId!==actorId||!Number.isFinite(Number(pointer.validUntil))||Number(pointer.validUntil)<=now)return null;
 try{
  const roles:unknown=JSON.parse(pointer.roles??'[]'),committeeIds:unknown=JSON.parse(pointer.committeeIds??'[]');
  if(!Array.isArray(roles)||!roles.length||!roles.every(r=>STAFF_ROLES.includes(r))||!Array.isArray(committeeIds)||!committeeIds.every(id=>typeof id==='string'))return null;
  if(roles.every(r=>r==='chair')&&!committeeIds.length)return null;
  return{status:'active',actorId,email,roles,committeeIds,validUntil:Number(pointer.validUntil)};
 }catch{return null;}
}
export function staffRoleForPath(path:string):Role|undefined{
 if(path.startsWith('/chair')||path.startsWith('/projector'))return'chair';
 if(path.startsWith('/approval'))return'approval';
 if(path.startsWith('/logistics'))return'logistics';
 if(path.startsWith('/admin'))return'admin';
}
export const staffRolePath=(role:Role)=>({chair:'/chair',approval:'/approval',logistics:'/logistics',admin:'/admin'})[role];
/** Cancels further transport work without deleting the independent actor-bound outbox. */
export class AccessGatedTransport implements Transport {
 actorId:string;
 constructor(private delegate:Transport,private allowed:()=>boolean){this.actorId=delegate.actorId;}
 private assertAccess(){if(!this.allowed())throw Error('Staff access is unavailable. Saved changes are retained for recovery.');}
 async read(){this.assertAccess();const data=await this.delegate.read();this.assertAccess();return data;}
 async send(m:Mutation){this.assertAccess();if(m.actorId!==this.actorId)throw Error('Saved action belongs to another staff identity.');await this.delegate.send(m);this.assertAccess();}
 subscribe(refresh:()=>void,state:(connected:boolean)=>void){this.assertAccess();return this.delegate.subscribe?.(()=>{if(this.allowed())refresh();},connected=>state(this.allowed()&&connected))??(()=>{});}
}
