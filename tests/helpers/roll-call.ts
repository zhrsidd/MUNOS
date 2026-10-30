import type {Command} from '../../lib/commands';
import type {AttendanceStatus} from '../../lib/domain';

/** A whole roll call as the Chair commits it (docs/SESSION_MODEL.md section 6); delegates left out are Absent. */
export const rollCall=(committeeId:string,statuses:Record<string,AttendanceStatus>,o:{id?:string;revision?:number;at?:string}={}):Command=>{
 const at=o.at??new Date().toISOString();
 return {type:'rollCallCommit',committeeId,rollCallId:o.id??crypto.randomUUID(),revision:o.revision??1,observedAt:at,committedAt:at,
  rows:Object.entries(statuses).map(([delegateId,status])=>({delegateId,status}))};
};
