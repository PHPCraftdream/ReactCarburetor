import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
import { Carburetor } from "../../Store/Carburetor.mjs";
import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
import { joinPath } from "../../Store/Paths/joinPath.mjs";
import { deepClone } from "../../Store/Utils/deepClone.mjs";
import { describeError } from "../describeError.mjs";
import { createAbortHandle } from "../createAbortHandle.mjs";
import { encodeCacheKey } from "./encodeCacheKey.mjs";
import { getInitialCacheEntry } from "./getInitialCacheEntry.mjs";
const DEFAULT_TTL = 30000;
const DEFAULT_MAX_ENTRIES = 100;
const ENTRIES_PREFIX = `entries${PATH_SEPARATOR}`;
class ResourceCache extends Carburetor {
    loader;
    ttl;
    maxEntries;
    requests = new Map();
    controllers = new Map();
    failures = new Map();
    lastUsed = new Map();
    useTick = 0;
    viewCache = new Map();
    constructor(loader, options = {}){
        super({
            entries: {}
        }, options.scheduler), this.loader = loader;
        this.ttl = void 0 === options.ttl ? DEFAULT_TTL : options.ttl;
        this.maxEntries = void 0 === options.maxEntries ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }
    restore = (data)=>{
        this.controllers.forEach((controller)=>controller.abort());
        this.controllers.clear();
        this.requests.clear();
        this.failures.clear();
        this.viewCache.clear();
        this.lastUsed.clear();
        const entries = {};
        Object.keys(data.entries).forEach((key)=>{
            const entry = data.entries[key];
            entries[key] = {
                ...entry,
                refreshing: false,
                status: entry.status === EResourceStatus.Pending ? EResourceStatus.Idle : entry.status
            };
        });
        this.setData(deepClone({
            entries
        }));
    };
    touch = (key)=>{
        this.useTick += 1;
        this.lastUsed.set(key, this.useTick);
    };
    lastKeyArgs = void 0;
    lastKeyJson = void 0;
    lastKeyValue = void 0;
    keyMutationReported = false;
    keyOf = (args)=>{
        const json = JSON.stringify(void 0 === args ? null : args);
        const memoized = this.lastKeyArgs === args && void 0 !== this.lastKeyValue;
        if (memoized && this.lastKeyJson === json && void 0 !== this.lastKeyValue) return this.lastKeyValue;
        const key = encodeCacheKey(args);
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
    load = (args)=>{
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus.Success && !this.isStale(entry)) return Promise.resolve();
        return this.fetch(key, args);
    };
    refresh = (args)=>{
        const key = this.keyOf(args);
        this.touch(key);
        return this.fetch(key, args);
    };
    abort = (args)=>{
        this.abortKey(this.keyOf(args));
    };
    abortAll = ()=>{
        Array.from(this.controllers.keys()).forEach((key)=>this.abortKey(key));
    };
    invalidate = (args)=>{
        const key = this.keyOf(args);
        if (!this.data.entries[key]) return;
        this.update((draft)=>{
            draft.entries[key].invalidated = true;
            draft.entries[key].failed = false;
        });
    };
    invalidateAll = ()=>{
        const keys = Object.keys(this.data.entries);
        if (0 === keys.length) return;
        this.update((draft)=>{
            keys.forEach((key)=>{
                draft.entries[key].invalidated = true;
                draft.entries[key].failed = false;
            });
        });
    };
    forget = (args)=>{
        this.forgetKey(this.keyOf(args));
    };
    forgetAll = ()=>{
        Object.keys(this.data.entries).forEach((key)=>this.forgetKey(key));
    };
    forgetKey = (key)=>{
        this.abortKey(key);
        this.failures.delete(key);
        this.lastUsed.delete(key);
        this.viewCache.delete(key);
        if (!this.data.entries[key]) return;
        this.update((draft)=>{
            delete draft.entries[key];
        });
    };
    isStale = (entry)=>{
        if (entry.invalidated || void 0 === entry.updatedAt) return true;
        return Date.now() - entry.updatedAt > this.ttl;
    };
    isViewCurrent = (view, entry, stale)=>view.stale === stale && view.status === entry.status && view.data === entry.data && view.error === entry.error && view.updatedAt === entry.updatedAt && view.refreshing === entry.refreshing && view.invalidated === entry.invalidated && view.failed === entry.failed;
    retainedKeys = ()=>{
        const retained = new Set();
        Object.keys(this.subscribers).forEach((id)=>{
            this.subscribers[id].reads.forEach((read)=>{
                if (!read.startsWith(ENTRIES_PREFIX)) return;
                const segment = read.slice(ENTRIES_PREFIX.length).split(PATH_SEPARATOR)[0];
                if (segment) retained.add(segment);
            });
        });
        return retained;
    };
    evict = (deferNotification = false)=>{
        const keys = Object.keys(this.data.entries);
        if (keys.length <= this.maxEntries) return;
        const retained = this.retainedKeys();
        const candidates = keys.filter((key)=>!this.requests.has(key) && !retained.has(joinPath('', key))).sort((left, right)=>(this.lastUsed.get(left) || 0) - (this.lastUsed.get(right) || 0));
        const excess = keys.length - this.maxEntries;
        const doomed = candidates.slice(0, excess);
        if (0 === doomed.length) return;
        doomed.forEach((key)=>{
            this.failures.delete(key);
            this.lastUsed.delete(key);
            this.viewCache.delete(key);
        });
        const draft = this.draft;
        doomed.forEach((key)=>{
            delete draft.entries[key];
        });
        if (deferNotification) {
            if (!this.pendingEmit) this.emitSoon();
            return;
        }
        this.emitUpdate();
    };
    abortKey = (key)=>{
        const controller = this.controllers.get(key);
        if (!controller) return;
        controller.abort();
        this.controllers.delete(key);
        this.requests.delete(key);
        const entry = this.data.entries[key];
        if (entry && entry.status === EResourceStatus.Pending) return void this.update((draft)=>{
            draft.entries[key].status = EResourceStatus.Idle;
        });
        if (entry && entry.refreshing) this.update((draft)=>{
            draft.entries[key].refreshing = false;
        });
    };
    suspend = (args)=>{
        const key = this.keyOf(args);
        const entry = this.data.entries[key];
        this.touch(key);
        if (entry && entry.status === EResourceStatus.Success && void 0 !== entry.data) return entry.data;
        if (entry && entry.status === EResourceStatus.Error) throw this.failures.get(key) || new Error(entry.error || 'Carburetor: resource failed');
        const known = this.requests.get(key);
        throw known || this.fetch(key, args, true);
    };
    fetch = (key, args, deferNotification = false)=>{
        const known = this.requests.get(key);
        if (known) return known;
        const controller = createAbortHandle();
        this.controllers.set(key, controller);
        this.markLoading(key, deferNotification);
        let answer;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error) {
            answer = Promise.reject(error);
        }
        const request = answer.then((data)=>{
            this.settleSuccess(key, controller, data);
        }, (error)=>{
            this.settleFailure(key, controller, error);
        });
        this.requests.set(key, request);
        this.evict(deferNotification);
        return request;
    };
    markLoading = (key, deferNotification)=>{
        const entry = this.data.entries[key];
        const draft = this.draft;
        if (entry) if (void 0 === entry.data) {
            draft.entries[key].status = EResourceStatus.Pending;
            draft.entries[key].error = void 0;
        } else draft.entries[key].refreshing = true;
        else draft.entries[key] = {
            ...getInitialCacheEntry(),
            status: EResourceStatus.Pending
        };
        if (deferNotification) return void this.emitSoon();
        this.emitUpdate();
    };
    isCurrent = (key, controller)=>this.controllers.get(key) === controller && !controller.signal.aborted;
    settleSuccess = (key, controller, data)=>{
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) return;
        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.delete(key);
        this.update((draft)=>{
            draft.entries[key].status = EResourceStatus.Success;
            draft.entries[key].data = data;
            draft.entries[key].error = void 0;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = false;
            draft.entries[key].failed = false;
        });
        this.evict();
    };
    settleFailure = (key, controller, error)=>{
        if (!this.isCurrent(key, controller) || !this.data.entries[key]) return;
        this.controllers.delete(key);
        this.requests.delete(key);
        this.failures.set(key, error);
        const hasData = this.data.entries[key] && void 0 !== this.data.entries[key].data;
        this.update((draft)=>{
            draft.entries[key].error = describeError(error);
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = true;
            if (!hasData) draft.entries[key].status = EResourceStatus.Error;
        });
        this.evict();
    };
}
export { ResourceCache };
