import { TPath, TPathRecorder } from "../../Models/Paths.mjs";
/**
 * Read proxy: every field access is recorded as a path.
 * Writing through it is forbidden — writes belong to carburetor methods.
 */
export declare const createReadProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath) => T;
