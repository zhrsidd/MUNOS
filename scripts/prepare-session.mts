import {createClient} from '@supabase/supabase-js';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const env=Object.fromEntries((await readFile('.env.local','utf8')).split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
if(env.NEXT_PUBLIC_SUPABASE_URL!=='https://opmydpozhdgkpcnjwpqb.supabase.co')throw Error('Development project guard failed');
const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
await mkdir('.test-sessions',{recursive:true,mode:0o700});
let saved;
try { saved=JSON.parse(await readFile('.test-sessions/development.json','utf8')); } catch {}
const {data,error}=saved ? await client.auth.refreshSession({refresh_token:saved.refresh_token}) : await client.auth.signInAnonymously();
if(error){console.log('Anonymous session unavailable:',error.message);process.exit(1);}
await writeFile('.test-sessions/development.json',JSON.stringify(data.session),{mode:0o600});
console.log(JSON.stringify({userId:data.user!.id,project:'opmydpozhdgkpcnjwpqb'}));
