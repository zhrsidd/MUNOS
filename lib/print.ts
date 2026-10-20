import type {ConferenceData} from './domain';
/** Spare copies per resolution for the Chairs and the Approval Panel. */
export const PRINT_SPARES=3;
/** Copies to print: one per delegate in the committee plus spares, set each time a resolution is approved.
 *  Mirrors private.print_copies (Admins cannot read delegates, so the server counts them). Ported from PHESMUN. */
export function printCopies(d:Pick<ConferenceData,'delegates'>,committeeId:string){
 return Math.min(10000,d.delegates.filter(x=>x.committeeId===committeeId).length+PRINT_SPARES);
}
