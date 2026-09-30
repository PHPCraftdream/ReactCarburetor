import { TAliasLedger } from "../../Models/Paths.js";
/**
 * The development ledger behind the aliasing contract: the read proxy notes where each branch
 * object was read, and draft complains when it writes into an object that was read somewhere
 * else, since only the written path's subscribers are woken.
 *
 * It reports only — matching never consults it. Production gets `undefined`, which folds the
 * call sites and their message strings out of the bundle.
 *
 * `checkState`/`checkKey` are the state-model boundary (R6-02/R6-03): thrown, not reported,
 * since invalid state corrupts tracking rather than merely surprising it.
 */
export declare const createAliasLedger: () => TAliasLedger;
