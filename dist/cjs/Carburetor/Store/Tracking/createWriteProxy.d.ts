import { TPath, TPathRecorder } from "../../Models/Paths.js";
/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it.
 */
export declare const createWriteProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath) => T;
