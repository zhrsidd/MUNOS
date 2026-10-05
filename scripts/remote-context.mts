import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';
export const env=Object.fromEntries((await readFile('.env.local','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
export const ref='opmydpozhdgkpcnjwpqb';
if(env.NEXT_PUBLIC_SUPABASE_URL!==`https://${ref}.supabase.co`)throw Error('Development project guard failed');
export const ids=JSON.parse(await readFile('supabase/fixture-ids.json','utf8'));
export const session=JSON.parse(await readFile('.test-sessions/development.json','utf8'));
export function clientFor(token=session.access_token){return createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{global:{headers:{Authorization:`Bearer ${token}`}},accessToken:async()=>token,auth:{persistSession:false,autoRefreshToken:false}});}
