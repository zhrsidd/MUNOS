import {assertPreproductionPhase} from './preproduction-phase.mts';
import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';
import {assertToolTarget} from '../lib/platform/target-guard';
export const env=Object.fromEntries((await readFile('.env.local','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
// Only a project listed in STAGING_SUPABASE_REFS or DEVELOPMENT_SUPABASE_REFS (the DCMUN development project by default); never production.
export const ref=assertToolTarget(env.NEXT_PUBLIC_SUPABASE_URL,{...env,...process.env});
export const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8'));
export const session=JSON.parse(await readFile('.test-sessions/development.json','utf8'));
export function clientFor(token=session.access_token){return createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false}});}

export const verifyPhase=()=>assertPreproductionPhase(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{...env,...process.env});
