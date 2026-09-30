import { TPath, TPathRecorder, TAliasLedger, TPatchPort } from "../../Models/Paths.mjs";
import { IProxyCache } from "./Models.mjs";
/**
 * Builds a path-recording write proxy with one shared branch cache.
 *
 * @param target - raw state, filed for unwrapping values read back through draft
 * @param record - write-path sink; unwrappable leaves invalidate their owner
 * @param basePath - escaped dotted path, empty at the root
 * @param aliases - development alias and state-model validation
 * @param cache - shared branch-wrapper cache, created by the root call
 * @param patchPort - shared current listener and opaque recording mode
 * @param basePathSegments - unescaped path keys, empty at the root
 */
export declare const createWriteProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger, cache?: IProxyCache, patchPort?: TPatchPort, basePathSegments?: readonly string[]) => T;
