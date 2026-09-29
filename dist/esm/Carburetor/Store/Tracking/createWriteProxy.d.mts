import { TPath, TPathRecorder, TAliasLedger, TPatchPort } from "../../Models/Paths.mjs";
import { IProxyCache } from "./Models.mjs";
/**
 * Builds a write proxy over `target`: every changed branch is recorded as a path. The root
 * call mints its own cache; every nested branch call receives the same one back, so one
 * proxy tree caches as one unit.
 *
 * @param target - the raw object the proxy fronts; it is filed in proxyTargets so a value
 * read back through draft is unwrapped before the write compares it.
 * @param record - the store's write sink, feeding the paths the next emitUpdate announces;
 * the get trap also reports unwrappable objects handed out raw, imprecise but never a lost
 * update.
 * @param basePath - the dotted path this root answers for, '' being the store root; an index
 * or `length` write on an array is named like any other key.
 * @param aliases - consulted on every write to complain when it lands in an object another
 * path was read from, and to validate the state model (R6-02/R6-03); undefined outside
 * development.
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit.
 * @param patchPort - where this tree finds its currently attached patch listener, if any
 * (R16-07); threaded to every branch so attaching or detaching one needs no rebuild.
 * @param basePathSegments - `basePath`'s own keys, unescaped; '' the empty array at the root.
 */
export declare const createWriteProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger, cache?: IProxyCache, patchPort?: TPatchPort, basePathSegments?: readonly string[]) => T;
