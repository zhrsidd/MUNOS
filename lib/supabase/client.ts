import {createBrowserClient} from '@supabase/ssr';
export function browserClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)throw Error('Supabase environment is not configured.');
 return createBrowserClient(url,key);
}
