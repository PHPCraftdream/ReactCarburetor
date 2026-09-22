import { TDisposer } from "../Models/Base.js";
import { ICarburetor } from "../Models/Store.js";
import { IPersistOptions } from "../Models/Tooling.js";
/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export declare const persist: <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions) => TDisposer;
