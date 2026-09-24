import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { joinPath } from "../../Store/Paths/joinPath.mjs";
import { escapeCacheKey } from "./escapeCacheKey.mjs";
import { getInitialCacheEntry } from "./getInitialCacheEntry.mjs";
import { ResourceCacheLifecycle } from "./ResourceCacheLifecycle.mjs";
class ResourceCache extends ResourceCacheLifecycle {
    lastKeyArgs = void 0;
    lastKeyJson = void 0;
    lastKeyValue = void 0;
    keyMutationReported = false;
    constructor(loader, options = {}){
        super(loader, options);
    }
    keyOf = (args)=>{
        const json = JSON.stringify(void 0 === args ? null : args);
        const memoized = this.lastKeyArgs === args && void 0 !== this.lastKeyValue;
        if (memoized && this.lastKeyJson === json && void 0 !== this.lastKeyValue) return this.lastKeyValue;
        const key = escapeCacheKey(json);
        const development = "u" > typeof process && 'production' !== process.env.NODE_ENV;
        if (memoized && development && !this.keyMutationReported) {
            this.keyMutationReported = true;
            diagnostics.report(`a resource arguments object was mutated after its key was taken: the same reference now encodes to a different entry (${this.lastKeyValue} became ${key}), and the new key is the one being used. Build a fresh object per query rather than mutating one in place.`);
        }
        this.lastKeyArgs = args;
        this.lastKeyJson = json;
        this.lastKeyValue = key;
        return key;
    };
    pathOf = (args)=>joinPath('entries', this.keyOf(args));
    getEntry = (args)=>{
        const key = this.keyOf(args);
        const stored = this.data.entries[key];
        if (!stored) return {
            ...getInitialCacheEntry(),
            stale: true
        };
        this.touch(key);
        const stale = this.isStale(stored);
        const cached = this.viewCache.get(key);
        if (cached && this.isViewCurrent(cached, stored, stale)) return cached;
        const view = {
            ...stored,
            stale
        };
        this.viewCache.set(key, view);
        return view;
    };
    getFailure = (args)=>this.failures.get(this.keyOf(args));
}
export { ResourceCache };
