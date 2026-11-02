import type {Committee, ConferenceData} from './domain';
import type {StaffAccess} from './access';
import type {Health} from './sync/repository';

export const CHAIR_INTRO_MS = 5000;
export type OpeningState = {phase: 'idle' | 'checking' | 'artwork' | 'showing' | 'done'; committee: Committee | null};
export type OpeningInput = {access: StaffAccess; health: Health; data: ConferenceData | null; pathname: string; committeeId?: string; selectionReady?: boolean};
type Clock = {now: () => number; later: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>; cancel: (id: ReturnType<typeof setTimeout>) => void};
const clock: Clock = {now: () => performance.now(), later: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id)};

/** Recovery and authorization always win over optional decoration, including while a cache read is pending. */
export function mayShowChairOpening({access, health, pathname}: OpeningInput) {
 return access.status === 'active' && !!access.actorId && access.roles.includes('chair') &&
  Number.isFinite(access.validUntil) && access.validUntil! > Date.now() &&
  (pathname === '/chair' || pathname.startsWith('/chair/')) && pathname !== '/chair/health' &&
  health.conflicts === 0 && health.pending === 0 && health.state !== 'error' && health.state !== 'waiting';
}

/** One optional introduction per page lifetime. Repository startup runs independently of this controller. */
export class ChairOpening {
 private state: OpeningState = {phase:'idle', committee:null};
 private listeners = new Set<() => void>();
 private timer?: ReturnType<typeof setTimeout>;
 private input?: OpeningInput;
 private actor?: string;
 private remaining = CHAIR_INTRO_MS;
 private visibleSince?: number;

 constructor(private time: Clock = clock) {}
 getSnapshot = () => this.state;
 subscribe = (fn: () => void) => {this.listeners.add(fn); return () => {this.listeners.delete(fn);};};
 private set(phase: OpeningState['phase'], committee = this.state.committee) {this.state = {phase,committee}; this.listeners.forEach(fn => fn());}
 private clearTimer() {if(this.timer !== undefined)this.time.cancel(this.timer);this.timer=undefined;}
 private finish = () => {this.clearTimer();this.visibleSince=undefined;this.set('done',null);};
 canPresent(input: OpeningInput) {
  return mayShowChairOpening(input) && (!this.actor || input.access.actorId===this.actor) &&
   (!this.state.committee || input.access.committeeIds.includes(this.state.committee.id));
 }
 update(input: OpeningInput) {
  this.input=input;
  if(input.access.status==='signedOut'){
   this.clearTimer();this.visibleSince=undefined;this.remaining=CHAIR_INTRO_MS;this.actor=undefined;if(this.state.phase!=='idle')this.set('idle',null);
  }
  if(this.state.phase==='done')return;
  // Login/access checks have not consumed an introduction. Only an authorized workspace can start one.
  if(this.state.phase==='idle' && (input.access.status!=='active' || input.pathname==='/'))return;
  if(this.state.phase==='idle' && !input.data)return;
  if(!this.canPresent(input)){this.finish();return;}
  if(this.state.phase==='idle'){
   if(!input.data)return;
   if(!input.health.lastSynced){
    // Optional decoration must not hide usable cached work behind a hung first read.
    if(this.timer===undefined)this.timer=this.time.later(this.finish,5000);
    return;
   }
   if(input.selectionReady===false)return;
   this.clearTimer();
   const assigned=input.data.committees.filter(c=>!c.archived && input.access.committeeIds.includes(c.id));
   const committee=assigned.find(c=>c.id===input.committeeId) ?? assigned.find(c=>c.code==='GA1') ?? assigned[0];
   if(!committee || input.data.conference.features[`committeeLoadingScreen:${committee.id}`]!==true){this.finish();return;}
   this.actor=input.access.actorId;this.set('artwork',committee);this.timer=this.time.later(this.finish,5000);
  } else if(this.state.phase==='showing' && this.remaining<=0 && input.data)this.finish();
 }
 artworkReady = () => {if(this.state.phase!=='artwork')return;this.clearTimer();this.set('showing');};
 artworkFailed = () => {if(this.state.phase==='artwork'||this.state.phase==='showing')this.finish();};
 /** Called only after decoded artwork has been painted in a visible tab. Hidden time does not count. */
 presented = () => {
  if(this.state.phase!=='showing' || this.visibleSince!==undefined || this.remaining<=0)return;
  this.visibleSince=this.time.now();
  this.timer=this.time.later(()=>{this.remaining=0;this.visibleSince=undefined;this.timer=undefined;if(this.input?.data)this.finish();},this.remaining);
 };
 hidden = () => {
  if(this.visibleSince===undefined)return;
  this.remaining=Math.max(0,this.remaining-(this.time.now()-this.visibleSince));this.visibleSince=undefined;this.clearTimer();
 };
 skip = () => {if(this.input?.data && mayShowChairOpening(this.input) && this.state.phase==='showing')this.finish();};
}
