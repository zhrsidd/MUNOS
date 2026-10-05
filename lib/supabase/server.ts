import {createServerClient} from '@supabase/ssr';
import {cookies} from 'next/headers';
// Future server routes must verify getClaims/getUser and retain database RLS.
// No personalized server routes or shared-cache session responses exist yet.
export async function serverClient(){
 const store=await cookies();
 return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{
  cookies:{getAll:()=>store.getAll(),setAll:values=>{for(const {name,value,options} of values)store.set(name,value,options);}},
 });
}
