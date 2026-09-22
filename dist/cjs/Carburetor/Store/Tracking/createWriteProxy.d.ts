import { TPath, TPathRecorder, TAliasLedger } from "../../Models/Paths.js";
/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it. Reads made elsewhere are consulted through the alias
 * ledger, so writing into an object that another path was read from is reported in development.
 *
 * A landed write also publishes its recorded path to the proxy cache scope every proxy over the
 * same raw object shares: the caches release the replaced or deleted branches' old wrappers the
 * next time they are consulted, so an obsolete branch stops being pinned by the write that ended it.
 *
 * @param target - the raw object the proxy fronts; it is filed in proxyTargets so a value
 * read back through draft is unwrapped before the write compares it
 * @param record - the store's write sink, feeding the paths the next emitUpdate announces;
 * the get trap also reports unwrappable objects handed out raw, imprecise but never a lost
 * update
 * @param basePath - the dotted path this root answers for, '' being the store root; array
 * writes collapse onto it (or the wildcard) instead of naming an index
 * @param aliases - consulted on every write to complain when it lands in an object another
 * path was read from; undefined outside development
 */
export declare const createWriteProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger) => T;
