import {TPathSet} from "@/Carburetor/Models/Paths";
import {TCompletedReads} from "./Models";

/** Closes an internal read collection without copying.
 *
 * @param reads - internal set whose collection phase has finished.
 */
export const completeReads = (reads: TPathSet): TCompletedReads => reads as unknown as TCompletedReads;
