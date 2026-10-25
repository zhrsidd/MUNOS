import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {SupabaseTransport} from '../lib/supabase/repository';

type Frame = [string|null,string|null,string,string,Record<string,unknown>];
type JoinConfig = {postgres_changes_options?:{wait?:boolean};postgres_changes:Record<string,unknown>[]};

// Exercise the installed SDK and its actual Phoenix join payload, without contacting a service.
// Like the hosted server, this fixture acknowledges a plain join immediately; a waiting join
// is held until its PostgreSQL subscription is ready or fails.
function harness(){
 const sockets:HeldJoinSocket[]=[];
 class HeldJoinSocket extends EventTarget {
  readonly CONNECTING=0;readonly OPEN=1;readonly CLOSING=2;readonly CLOSED=3;
  readyState=0;protocol='';binaryType='arraybuffer';bufferedAmount=0;
  onopen:((event:Event)=>void)|null=null;
  onmessage:((event:MessageEvent)=>void)|null=null;
  onclose:((event:CloseEvent)=>void)|null=null;
  onerror:((event:Event)=>void)|null=null;
  join:Frame|undefined;
  constructor(public url:string|URL){super();sockets.push(this);queueMicrotask(()=>{this.readyState=1;this.onopen?.(new Event('open'));});}
  send(raw:string){
   const frame=JSON.parse(raw) as Frame;
   if(frame[3]==='phx_join'){
    this.join=frame;
    const config=frame[4].config as JoinConfig;
    if(!config.postgres_changes_options?.wait)queueMicrotask(()=>this.ready());
   }else if(frame[3]==='phx_leave'||frame[3]==='heartbeat'){
    queueMicrotask(()=>this.receive([frame[0],frame[1],frame[2],'phx_reply',{status:'ok',response:{}}]));
   }
  }
  receive(frame:Frame){this.onmessage?.(new MessageEvent('message',{data:JSON.stringify(frame)}));}
  ready(){
   assert.ok(this.join);
   const [joinRef,ref,topic,,payload]=this.join;
   const config=payload.config as JoinConfig;
   this.receive([joinRef,ref,topic,'phx_reply',{status:'ok',response:{postgres_changes:config.postgres_changes.map((binding,i)=>({...binding,id:i+1}))}}]);
  }
  refuse(){
   assert.ok(this.join);
   this.receive([this.join[0],this.join[1],this.join[2],'phx_reply',{status:'error',response:{reason:'PostgresChangesSubscribeTimeout'}}]);
  }
  change(){
   assert.ok(this.join);
   this.receive([null,null,this.join[2],'postgres_changes',{ids:[1],data:{schema:'public',table:'operational_changes',type:'INSERT',commit_timestamp:new Date().toISOString(),columns:[],record:{conference_id:'conference-test',committee_id:null,topic:'configuration'},old_record:{}}}]);
  }
  close(){this.readyState=3;this.onclose?.(Object.assign(new Event('close'),{code:1000,reason:'',wasClean:true}) as CloseEvent);}
 }
 const client=createClient('https://example.supabase.co','synthetic-public-test-key',{
  auth:{persistSession:false,autoRefreshToken:false},accessToken:async()=>null,
  realtime:{transport:HeldJoinSocket as unknown as typeof WebSocket},
  global:{fetch:async()=>{throw Error('No HTTP is allowed in the Realtime protocol fixture');}},
 });
 const transport=new SupabaseTransport(client,'conference-test','staff-test',[],false,['admin']);
 const states:boolean[]=[];let refreshes=0;
 const stop=transport.subscribe(()=>refreshes++,state=>states.push(state));
 return {states,refreshes:()=>refreshes,socket:()=>sockets.at(-1),async close(){stop();await client.removeAllChannels();await client.realtime.disconnect();}};
}

async function joined(h:ReturnType<typeof harness>){
 for(let i=0;i<50&&!h.socket()?.join;i++)await new Promise<void>(resolve=>setImmediate(resolve));
 assert.ok(h.socket()?.join,'the real SDK must send a channel join');
 // Let the non-waiting server reply run too: the old implementation would already be green.
 await new Promise<void>(resolve=>setImmediate(resolve));
 return h.socket()!;
}

test('real SDK: a cold PostgreSQL subscription is not reported connected before readiness',async()=>{
 const h=harness();
 try{
  const socket=await joined(h);
  assert.deepEqual(h.states,[],'an open socket and joined channel are not proof of database delivery');
  assert.equal(h.refreshes(),0);
  socket.ready();
  assert.deepEqual(h.states,[true]);
  socket.change();
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(h.refreshes(),1,'the ready subscription still delivers normal debounced invalidations');
 }finally{await h.close();}
});

test('real SDK: PostgreSQL subscription refusal reports disconnected for fallback recovery',async()=>{
 const h=harness();
 try{
  const socket=await joined(h);socket.refuse();
  assert.ok(h.states.length>0);
  assert.ok(h.states.every(state=>state===false),'a failed database subscription must never report connected');
  assert.equal(h.refreshes(),0);
 }finally{await h.close();}
});
