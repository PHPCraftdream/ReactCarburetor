import {TPathSet} from "@/Carburetor/Models/Paths";
import {ISubscribeOptions} from "@/Carburetor/Models/Store";
import {transferReads} from "@/Carburetor/Store/Paths/Markers/transferReads";
import {TCompletedReads} from "./Models";

/** Transfers a closed observation set into the subscriber index's mutable ownership.
 *
 * @param reads - completed internal set transferred by identity.
 * @param id - registration id to reuse.
 */
export const transferCompletedReads = (reads: TCompletedReads, id?: string): ISubscribeOptions => {
    // The index extends its owned Set as paths are filed; only this handoff crosses the readonly boundary.
    return transferReads(reads as unknown as TPathSet, id);
};
