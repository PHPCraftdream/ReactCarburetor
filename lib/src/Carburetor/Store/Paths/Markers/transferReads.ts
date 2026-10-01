import {TPathSet} from "@/Carburetor/Models/Paths";
import {ISubscribeOptions} from "@/Carburetor/Models/Store";
import {READS_TRANSFER} from "./ReadsTransferBrand";

/**
 * Hands an extendable internal set to `subscribe()` by reference — computed dependencies use
 * this path because late live reads may extend the adopted set after the computation body.
 *
 * `Carburetor.subscribe` adopts the Set as-is only when this exact instance is both
 * `options.reads` and the branded value; any override that swaps `reads` out, or a second copy
 * of the library, falls back to the safe copy instead.
 *
 * @param reads - the internal Set that may continue to grow through `extend()`
 * @param id - the subscription id to reuse, as in `ISubscribeOptions`
 */
export const transferReads = (reads: TPathSet, id?: string): ISubscribeOptions & {[READS_TRANSFER]?: TPathSet} => ({
    id, reads, [READS_TRANSFER]: reads,
});
