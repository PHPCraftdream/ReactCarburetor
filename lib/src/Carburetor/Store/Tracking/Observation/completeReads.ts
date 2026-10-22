import {TPathSet} from "../../../Models/Paths";
import {readCoverage} from "../../Paths/Markers/readCoverage";
import {TCompletedReads} from "./Models";

/** Closes an internal read collection without copying.
 *
 * @param reads - internal set whose collection phase has finished.
 */
export const completeReads = (reads: TPathSet): TCompletedReads => {
    readCoverage.prune(reads);
    return reads as unknown as TCompletedReads;
};
