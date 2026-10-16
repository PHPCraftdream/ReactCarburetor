import {TResourceArgs, TResourceKey} from "@/Carburetor/Models/Resource";
import {IUpdateScheduler} from "@/Carburetor/Models/Store";

/** Construction options for `ResourceCarburetor`; every field is optional. */
export interface IResourceCarburetorOptions<TArgs extends TResourceArgs = []> {
    /** Derives the shared-answer identity; the default key applies when omitted. */
    key?: TResourceKey<TArgs>;

    /** Non-negative milliseconds; fractional values and `Infinity` are valid. `Infinity` never goes stale. */
    ttl?: number;

    /** Non-negative integer or `Infinity`; zero keeps no answers, `Infinity` disables eviction. */
    maxEntries?: number;

    /** The policy deciding when subscribers are woken; omitted, updates publish synchronously. */
    scheduler?: IUpdateScheduler;
}
