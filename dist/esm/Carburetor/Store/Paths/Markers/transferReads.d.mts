import { TPathSet } from "../../../Models/Paths.mjs";
import { ISubscribeOptions } from "../../../Models/Store.mjs";
import { READS_TRANSFER } from "./ReadsTransferBrand.mjs";
/**
 * Hands `reads` to `subscribe()` by reference instead of letting it copy — for an internal
 * caller that holds the only reference and never grows it except through `extend()`.
 *
 * `Carburetor.subscribe` adopts the Set as-is only when this exact instance is both
 * `options.reads` and the branded value; any override that swaps `reads` out, or a second copy
 * of the library, falls back to the safe copy instead.
 *
 * @param reads - the Set `subscribe()` may keep and mutate through `extend()` afterward
 * @param id - the subscription id to reuse, as in `ISubscribeOptions`
 */
export declare const transferReads: (reads: TPathSet, id?: string) => ISubscribeOptions & {
    [READS_TRANSFER]?: TPathSet;
};
