import { TPath, TPathRecorder, TAliasLedger } from "../../Models/Paths.mjs";
/**
 * Read proxy: every field access is recorded as a path.
 * Writing through it is forbidden — writes belong to carburetor methods.
 *
 * Two contracts the recording relies on. Accessors run against the proxy — it is handed to
 * `Reflect.get` as the receiver — so the reads a getter makes internally are tracked like any
 * other; a getter that returns a branch is an alias by another name and is not supported. And
 * the data is a tree, one object at one path: a second path to a live object is reported in
 * development through the alias ledger, which production compiles out.
 */
export declare const createReadProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger) => T;
