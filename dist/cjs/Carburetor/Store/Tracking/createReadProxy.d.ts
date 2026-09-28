import { TPath, TPathRecorder, TAliasLedger } from "../../Models/Paths.js";
import { IProxyCache } from "./Models.js";
/**
 * Builds a read proxy over `target`: every field access is recorded as a path, and writing,
 * defining or restructuring through it is refused. The root call mints its own cache; every
 * nested branch call receives the same one back, so one proxy tree caches as one unit.
 *
 * @param target - the raw state this proxy fronts, held by reference: nothing copies it, so
 * every trap answers from the object as it is now.
 * @param record - where each touched path is reported, supplied by read(); a branch read
 * reports the branch marker, not every path inside it.
 * @param basePath - the dotted path this root answers for; the default '' is the store root,
 * where `ownKeys` records the bare key-set marker instead of one qualified by a path.
 * @param aliases - development-only: notes each branch object under its path so a second
 * path to the same object is reported; production hands in undefined.
 * @param cache - the branch-wrapper cache this whole proxy tree shares; the root call leaves
 * this undefined and mints one, and every nested branch receives it back so the tree caches
 * as one unit.
 */
export declare const createReadProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger, cache?: IProxyCache) => T;
