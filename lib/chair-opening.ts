import type {Committee, ConferenceData} from './domain';
import type {StaffAccess} from './access';
import type {Health} from './sync/repository';

export const CHAIR_INTRO_MS = 3000;
export type OpeningState = {phase: 'idle' | 'checking' | 'artwork' | 'showing' | 'done'; committee: Committee | null};
export type OpeningInput = {access: StaffAccess; health: Health; data: ConferenceData | null; pathname: string};
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
 private generation = 0;
 constructor(private select: (access: StaffAccess) => Promise<Committee | null>, private time: Clock = clock) {}
 getSnapshot = () => this.state;
 subscribe = (fn: () => void) => {this.listeners.add(fn); return () => {this.listeners.delete(fn);};};
 private set(phase: OpeningState['phase'], committee = this.state.committee) {this.state = {phase,committee}; this.listeners.forEach(fn => fn());}
 private clearTimer() {if(this.timer !== undefined)this.time.cancel(this.timer);this.timer=undefined;}
 private finish = () => {this.generation++;this.clearTimer();this.visibleSince=undefined;this.set('done',null);};
 canPresent(input: OpeningInput) {
  return mayShowChairOpening(input) && (!this.actor || input.access.actorId===this.actor) &&
   (!this.state.committee || input.access.committeeIds.includes(this.state.committee.id));
 }
 update(input: OpeningInput) {
  this.input=input;
  if(this.state.phase==='done')return;
  if(this.state.phase==='idle' && (input.access.status==='loading' || (input.pathname==='/' && input.access.status==='active' && input.access.roles.includes('chair'))))return;
  if(!this.canPresent(input)){this.finish();return;}
  if(this.state.phase==='idle'){
   this.actor=input.access.actorId;const generation=++this.generation;this.set('checking');
   // Broken optional storage must not trap a ready workspace.
   this.timer=this.time.later(this.finish,1500);
   void this.select(input.access).then(committee=>{
    if(generation!==this.generation)return;
    this.clearTimer();
    if(!committee || !this.input || !mayShowChairOpening(this.input) || !this.input.access.committeeIds.includes(committee.id)){this.finish();return;}
    this.set('artwork',committee);this.timer=this.time.later(this.finish,5000);
   }).catch(()=>{if(generation===this.generation)this.finish();});
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
