import type {ConferenceData,ScoringDefinition} from './domain';
// Procedure categories the Chair console depends on. They always exist (conference defaults fill gaps),
// so a blank conference is usable before an Executive saves anything. The server mirrors these defaults
// in private.scoring_values(). Speech and POI values are configurable; Main Submitter is a fixed +5,
// credited once per resolution, and cannot be configured or overridden.
export const MAIN_SUBMITTER_POINTS=5;
const MAIN_SUBMITTER:ScoringDefinition={id:'submitter',label:'Main Submitter',values:[MAIN_SUBMITTER_POINTS]};
export const REQUIRED_SCORING:readonly ScoringDefinition[]=[
 {id:'speech',label:'Speech',values:[1,2,3]},
 {id:'poi',label:'POI',values:[1,2]},
 MAIN_SUBMITTER,
];
export const MAX_SCORING_VALUES=10;
const required=(id:string)=>REQUIRED_SCORING.find(s=>s.id===id);
/** Configurable categories an Executive may set (Main Submitter is locked). */
export const isConfigurableScoring=(id:string)=>id!==MAIN_SUBMITTER.id;
/** Conference defaults: configured definitions, with required procedure categories filled from the built-in defaults. */
export function conferenceScoring(data:Pick<ConferenceData,'scoring'>):ScoringDefinition[]{
 return [...REQUIRED_SCORING.map(r=>isConfigurableScoring(r.id)?data.scoring.find(s=>s.id===r.id)??r:r),...data.scoring.filter(s=>!required(s.id))];
}
/** Effective definitions for one committee: a committee override replaces only its own category. */
export function effectiveScoring(data:Pick<ConferenceData,'scoring'|'committees'>,committeeId:string):ScoringDefinition[]{
 const overrides=data.committees.find(c=>c.id===committeeId)?.scoringOverrides;
 return conferenceScoring(data).map(s=>isConfigurableScoring(s.id)?overrides?.find(o=>o.id===s.id)??s:s);
}
export function scoringValues(data:Pick<ConferenceData,'scoring'|'committees'>,committeeId:string,id:string):number[]{
 return effectiveScoring(data,committeeId).find(s=>s.id===id)?.values??[];
}
export const scoringLabel=(data:Pick<ConferenceData,'scoring'>,id:string)=>conferenceScoring(data).find(s=>s.id===id)?.label??id;
/** Null when valid; otherwise the reason. Main Submitter is a fixed once-per-resolution credit. */
export function scoringProblem(id:string,values:number[]):string|null{
 if(!isConfigurableScoring(id))return 'Main Submitter credit is fixed at +5 and cannot be changed.';
 if(!values.length||values.length>MAX_SCORING_VALUES||values.some(n=>!Number.isInteger(n)||n<0||n>20))return `Use 1–${MAX_SCORING_VALUES} whole-number points from 0 to 20.`;
 if(new Set(values).size!==values.length)return 'Each point value may appear only once.';
 return null;
}
export function parseScoringValues(text:string):number[]{
 return text.split(',').map(x=>x.trim()).filter(Boolean).map(Number).sort((a,b)=>a-b);
}
