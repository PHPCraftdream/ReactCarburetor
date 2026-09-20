import { TDisposer } from "../Models/Base.mjs";
import { ICarburetor } from "../Models/Store.mjs";
import { IPersistOptions } from "../Models/Tooling.mjs";
/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 */
export declare const persist: <T extends {}>(carburetor: ICarburetor<T>, options: IPersistOptions) => TDisposer;
