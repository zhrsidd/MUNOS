import type {SupabaseClient} from '@supabase/supabase-js';
import type {Role} from './domain';
export const CODE_INVALID='That code is invalid or expired. Check it with the Executive team.';
export const CODE_LIMITED='Too many attempts. Please wait 10 minutes before trying again.';
export type RedemptionStatus='ok'|'invalid'|'rate_limited';
export interface AccessCodeStatus {id:string;role:Role;committeeId:string|null;committeeCode:string|null;committeeName:string|null;createdAt:string;expiresAt:string;revokedAt:string|null;active:boolean}
/** Called only by the form submit handler. Code exists only in memory and the RPC request body. */
export async function redeemStaffCode(client:SupabaseClient,conferenceId:string,code:string):Promise<RedemptionStatus>{
 if(!code.trim())return'invalid';
 const {data:{session},error}=await client.auth.getSession();
 if(error)throw Error('Unable to check this device session. Reconnect and retry.');
 if(!session){const created=await client.auth.signInAnonymously();if(created.error)throw Error('Unable to prepare this device. Ask the Executive team to check staff access configuration.');}
 const result=await client.rpc('redeem_access_code',{conf:conferenceId,code});
 if(result.error)throw Error('Unable to redeem access right now. Reconnect and retry.');
 const status=result.data?.status;
 if(status!=='ok'&&status!=='invalid'&&status!=='rate_limited')throw Error('Unable to confirm access. Retry shortly.');
 return status;
}
export async function listAccessCodes(client:SupabaseClient,conf:string):Promise<AccessCodeStatus[]>{const {data,error}=await client.rpc('access_code_status',{conf});if(error)throw Error('Unable to load access-code status. Check your Executive access.');return data??[];}
export async function rotateAccessCode(client:SupabaseClient,conf:string,role:Role,committeeId:string|null,expiresAt:string):Promise<string>{
 const {data,error}=await client.rpc('rotate_access_code',{conf,requested_role:role,committee:committeeId,expires_at:expiresAt});
 if(error)throw Error('Code creation could not be confirmed. Refresh status before rotating again.');
 if(typeof data?.code!=='string')throw Error('The new code could not be displayed. Refresh status before rotating again.');return data.code;
}
export async function revokeAccessCode(client:SupabaseClient,conf:string,id:string,revokeDevices:boolean){
 const {error}=await client.rpc('revoke_access_code',{conf,credential:id,revoke_devices:revokeDevices});if(error)throw Error('Revocation could not be confirmed. Refresh status and retry.');
}
