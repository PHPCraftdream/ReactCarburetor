import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { joinPath } from "../../Store/Paths/joinPath.mjs";
import { escapeCacheKey } from "./escapeCacheKey.mjs";
import { getInitialCacheEntry } from "./getInitialCacheEntry.mjs";
import { ResourceCacheLifecycle } from "./ResourceCacheLifecycle.mjs";
const ABSENT_VIEW = Object.freeze({
    ...getInitialCacheEntry(),
    stale: true
});
const validateOptions = (options)=>{
    if (void 0 !== options.ttl && (Number.isNaN(options.ttl) || options.ttl < 0)) throw new RangeError('ResourceCache ttl must be a non-negative number');
    if (void 0 !== options.maxEntries && 1 / 0 !== options.maxEntries && (!Number.isInteger(options.maxEntries) || options.maxEntries < 0)) throw new RangeError('ResourceCache maxEntries must be a non-negative integer or Infinity');
    return options;
};
class ResourceCache extends ResourceCacheLifecycle {
    lastKeyArgs = void 0;
    lastKeyJson = void 0;
    lastKeyValue = void 0;
    keyMutationReported = false;
    constructor(loader, options = {}){
        super(loader, validateOptions(options));
    }
    didSetData() {
        const keys = Object.keys(this.data.entries);
        this.eviction.replace(keys);
        this.viewCache.clear();
        for (const key of this.failures.keys())if (!Object.prototype.hasOwnProperty.call(this.data.entries, key)) this.failures.delete(key);
    }
    keyOf(args) {
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
    }
    pathOf(args) {
        return this.pathOfKey(this.keyOf(args));
    }
    pathOfKey(key) {
        return joinPath('entries', key);
    }
    getEntry(args) {
        return this.getEntryByKey(this.keyOf(args));
    }
    getEntryByKey(key) {
        const stored = this.data.entries[key];
        if (!stored) return ABSENT_VIEW;
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
    }
    fromJSON(value) {
        this.restore(value);
    }
    resolve(args) {
        const key = this.keyOf(args);
        return {
            key,
            path: this.pathOfKey(key),
            view: this.getEntryByKey(key)
        };
    }
    getFailure(args) {
        return this.failures.get(this.keyOf(args));
    }
}
export { ResourceCache };
