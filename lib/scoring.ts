import type {ConferenceData,ScoringDefinition} from './domain';
// Procedure categories the Chair console depends on. They always exist (conference defaults fill gaps),
// so a blank conference is usable before an Executive saves anything. The server mirrors these defaults
// in private.scoring_values(). Every category is configurable per conference and per committee.
// Main Submitter is one value, credited once per resolution on the Main Submitter's first scored speech;
// a stored credit keeps the points it was given.
export const MAIN_SUBMITTER_POINTS=5;
export const MAIN_SUBMITTER_ID='submitter';
export const REQUIRED_SCORING:readonly ScoringDefinition[]=[
 {id:'speech',label:'Speech',values:[1,2,3]},
 {id:'poi',label:'POI',values:[1,2]},
 {id:MAIN_SUBMITTER_ID,label:'Main Submitter',values:[MAIN_SUBMITTER_POINTS]},
 {id:'amendment',label:'Debated amendment',values:[3]},
];
export const MAX_SCORING_VALUES=10;
const required=(id:string)=>REQUIRED_SCORING.find(s=>s.id===id);
/** Conference defaults: configured definitions, with required procedure categories filled from the built-in defaults. */
export function conferenceScoring(data:Pick<ConferenceData,'scoring'>):ScoringDefinition[]{
 return [...REQUIRED_SCORING.map(r=>data.scoring.find(s=>s.id===r.id)??r),...data.scoring.filter(s=>!required(s.id))];
}
/** Effective definitions for one committee: a committee override replaces only its own category. */
export function effectiveScoring(data:Pick<ConferenceData,'scoring'|'committees'>,committeeId:string):ScoringDefinition[]{
 const overrides=data.committees.find(c=>c.id===committeeId)?.scoringOverrides;
 return conferenceScoring(data).map(s=>overrides?.find(o=>o.id===s.id)??s);
}
export function scoringValues(data:Pick<ConferenceData,'scoring'|'committees'>,committeeId:string,id:string):number[]{
 return effectiveScoring(data,committeeId).find(s=>s.id===id)?.values??[];
}
export const scoringLabel=(data:Pick<ConferenceData,'scoring'>,id:string)=>conferenceScoring(data).find(s=>s.id===id)?.label??id;
/** Main Submitter credit for a committee: its single configured value. */
export const mainSubmitterPoints=(data:Pick<ConferenceData,'scoring'|'committees'>,committeeId:string)=>scoringValues(data,committeeId,MAIN_SUBMITTER_ID)[0]??MAIN_SUBMITTER_POINTS;
/** Null when valid; otherwise the reason. Main Submitter is a single credit, so it takes exactly one value. */
export function scoringProblem(id:string,values:number[]):string|null{
 if(id===MAIN_SUBMITTER_ID)return values.length===1&&Number.isInteger(values[0])&&values[0]>=1&&values[0]<=20?null:'Main Submitter credit is one whole number from 1 to 20.';
 if(!values.length||values.length>MAX_SCORING_VALUES||values.some(n=>!Number.isInteger(n)||n<0||n>20))return `Use 1–${MAX_SCORING_VALUES} whole-number points from 0 to 20.`;
 if(new Set(values).size!==values.length)return 'Each point value may appear only once.';
 return null;
}
export function parseScoringValues(text:string):number[]{
 return text.split(',').map(x=>x.trim()).filter(Boolean).map(Number).sort((a,b)=>a-b);
}
