/**
 * Brands an internal `subscribe()` call's options as handing over the exact Set they hold,
 * not a snapshot the public contract copies — see `transferReads`. Not re-exported from the
 * package barrel: only `Carburetor.subscribe` and `transferReads` itself ever need it.
 */
export declare const READS_TRANSFER: unique symbol;
