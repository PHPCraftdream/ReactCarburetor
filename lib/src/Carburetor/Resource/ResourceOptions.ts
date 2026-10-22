import {TResourceArgs, TResourceKey} from "../Models/Resource";
import {IUpdateScheduler} from "../Models/Store";

/** Construction options for `ResourceCarburetor`; every field is optional. */
export interface IResourceCarburetorOptions<TArgs extends TResourceArgs = []> {
    /** Derives the shared-answer identity; the default key applies when omitted. */
    key?: TResourceKey<TArgs>;

    /** Non-negative milliseconds; fractional values and `Infinity` are valid.
     * `Infinity` never goes stale. Defaults to 30 000. */
    ttl?: number;

    /** Non-negative integer or `Infinity`; zero keeps no answers, `Infinity` disables eviction. Defaults to 100. */
    maxEntries?: number;

    /** The policy deciding when subscribers are woken; omitted, updates publish synchronously. */
    scheduler?: IUpdateScheduler;
}
