import { TDisposer } from "../Models/Base.js";
import { ICarburetor } from "../Models/Store.js";
import { IPersistOptions } from "../Models/Tooling.js";
/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 */
export declare const persist: <T extends {}>(carburetor: ICarburetor<T>, options: IPersistOptions) => TDisposer;
