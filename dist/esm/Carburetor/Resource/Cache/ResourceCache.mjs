import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { joinPath } from "../../Store/Paths/joinPath.mjs";
import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
import { WILDCARD_PATH } from "../../Store/Paths/WildcardPath.mjs";
import { escapeCacheKey } from "./escapeCacheKey.mjs";
import { getInitialCacheEntry } from "./getInitialCacheEntry.mjs";
import { ResourceCacheLifecycle } from "./ResourceCacheLifecycle.mjs";
import { isViewCurrent } from "./isViewCurrent.mjs";
const ABSENT_VIEW = Object.freeze({
    ...getInitialCacheEntry(),
    stale: true
});
const ENTRY_PATH_PREFIX = `entries${PATH_SEPARATOR}`;
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
    replacedEntries;
    constructor(loader, options = {}){
        super(loader, validateOptions(options));
    }
    setData(data) {
        const outerEntries = this.replacedEntries;
        this.replacedEntries = this.data.entries;
        try {
            return super.setData(data);
        } finally{
            this.replacedEntries = outerEntries;
        }
    }
    didSetData() {
        const keys = Object.keys(this.data.entries);
        this.eviction.replace(keys);
        this.viewCache.forEach((_view, key)=>{
            if (!Object.prototype.hasOwnProperty.call(this.data.entries, key)) this.viewCache.delete(key);
        });
        for (const key of this.failures.keys()){
            var _this_replacedEntries;
            if (!Object.prototype.hasOwnProperty.call(this.data.entries, key) || (null == (_this_replacedEntries = this.replacedEntries) ? void 0 : _this_replacedEntries[key]) !== this.data.entries[key]) this.failures.delete(key);
        }
    }
    preEmit() {
        if (0 === this.failures.size || 0 === this.writes.size && this.draftTouched) return;
        if (0 === this.writes.size || this.writes.has(WILDCARD_PATH) || this.writes.has('entries')) this.failures.forEach(this.reconcileFailure, this);
        else this.writes.forEach(this.reconcileFailureWrite, this);
    }
    reconcileFailure(failure, key) {
        const entry = this.data.entries[key];
        if (entry && failure.status === EResourceStatus.Error && void 0 === entry.error && (entry.status === EResourceStatus.Pending && this.requests.has(key) || entry.status === EResourceStatus.Idle && entry.failed)) return;
        if (!entry || entry.status !== failure.status || entry.error !== failure.error) this.failures.delete(key);
    }
    reconcileFailureWrite(path) {
        if (!path.startsWith(ENTRY_PATH_PREFIX)) return;
        const end = path.indexOf(PATH_SEPARATOR, ENTRY_PATH_PREFIX.length);
        if (-1 !== end) {
            const field = path.slice(end + 1);
            if ('status' !== field && 'error' !== field) return;
        }
        const escaped = path.slice(ENTRY_PATH_PREFIX.length, -1 === end ? void 0 : end);
        const key = escaped.includes('~') ? escaped.replace(/~1/g, PATH_SEPARATOR).replace(/~0/g, '~') : escaped;
        const failure = this.failures.get(key);
        if (failure) this.reconcileFailure(failure, key);
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
        if (cached && isViewCurrent(cached, stored, stale)) return cached;
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
        var _this_failures_get;
        return null == (_this_failures_get = this.failures.get(this.keyOf(args))) ? void 0 : _this_failures_get.value;
    }
}
export { ResourceCache };
