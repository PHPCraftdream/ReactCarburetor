import { TPath, TPathRecorder, TAliasLedger } from "../../Models/Paths.js";
/**
 * Write proxy: every changed branch is recorded as a path, so the carburetor
 * only wakes the subscribers that read it. Reads made elsewhere are consulted through the alias
 * ledger, so writing into an object that another path was read from is reported in development.
 */
export declare const createWriteProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger) => T;
