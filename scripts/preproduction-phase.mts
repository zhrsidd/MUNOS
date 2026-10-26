import {assertToolTarget, type Env} from '../lib/platform/target-guard';

/** A fresh, read-only phase lookup before Auth enrollment or synthetic work. No token/session creation.
 * The committed registry is checked before this first request. A lookup failure is never an override.
 * The database class barrier protects writes after this check; this is not signed freshness/attestation.
 */
export async function assertPreproductionPhase(url: string | undefined, key: string | undefined, env: Env, fetcher: typeof fetch = fetch) {
 const ref=assertToolTarget(url,env);
 if(!key?.trim())throw Error('Phase guard refused: publishable key missing. Nothing was contacted.');
 let data:unknown;
 try{
  const response=await fetcher(`${new URL(url!).origin}/rest/v1/rpc/preproduction_status`,{
   method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',cache:'no-store',
   signal:AbortSignal.timeout(5000),redirect:'error'
  });
  if(!response.ok)throw Error('unavailable');
  data=await response.json();
 }catch{throw Error('Phase guard refused: lifecycle verification unavailable. No synthetic work was started.');}
 if(!data||typeof data!=='object')throw Error('Phase guard refused: invalid lifecycle status.');
 const status=data as Record<string,unknown>;
 if(status.projectRef!==ref||!['preproduction','rehearsal'].includes(String(status.phase))||status.canTest!==true||!Number.isSafeInteger(status.revision)||Number(status.revision)<1)
  throw Error('Phase guard refused: production, unknown, contradictory or invalid lifecycle status.');
 return {ref,phase:status.phase as 'preproduction'|'rehearsal',revision:status.revision as number,checkedAt:new Date().toISOString()};
}
