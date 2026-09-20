import { TPath, TPathRecorder } from "./Models.mjs";
/** Only plain objects and arrays are worth wrapping — everything else is passed through. */
export declare const isTrackable: (value: unknown) => value is object;
/**
 * Read proxy: every field access is recorded as a path.
 * Writing through it is forbidden — writes belong to carburetor methods.
 */
export declare const createReadProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath) => T;
/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it.
 */
export declare const createWriteProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath) => T;
