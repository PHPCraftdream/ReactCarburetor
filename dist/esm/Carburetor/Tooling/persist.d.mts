import { TDisposer } from "../Models/Base.mjs";
import { ICarburetor } from "../Models/Store.mjs";
import { IPersistOptions } from "../Models/Tooling.mjs";
/**
 * Keeps a carburetor mirrored in a storage: loads the stored state once on connect, then
 * writes a snapshot on every change. Returns a disposer that stops the mirroring.
 *
 * Persistence is synchronous by default: a write lands in storage before the call that caused
 * it returns, which the engine's own tests rely on. `options.coalesce` trades that for one
 * stringify per microtask instead of one per write (R16-09) — the latest state is still what
 * gets stored, and the disposer flushes a write still pending.
 *
 * @param carburetor - both read and written: its snapshot is stored, stored data is restored into it
 * @param options - `key` and `storage` are required; a failed load or write reaches `onError` when given
 */
export declare const persist: <T extends object>(carburetor: ICarburetor<T>, options: IPersistOptions) => TDisposer;
