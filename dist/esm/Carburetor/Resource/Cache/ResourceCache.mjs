import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
import { Carburetor } from "../../Store/Carburetor.mjs";
import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
import { describeError } from "../describeError.mjs";
import { encodeCacheKey } from "./encodeCacheKey.mjs";
import { getInitialCacheEntry } from "./getInitialCacheEntry.mjs";
const DEFAULT_TTL = 30000;
const DEFAULT_MAX_ENTRIES = 100;
class ResourceCache extends Carburetor {
    loader;
    ttl;
    maxEntries;
    requests = new Map();
    controllers = new Map();
    failures = new Map();
    lastUsed = new Map();
    useTick = 0;
    constructor(loader, options = {}){
        super({
            entries: {}
        }, options.scheduler), this.loader = loader;
        this.ttl = void 0 === options.ttl ? DEFAULT_TTL : options.ttl;
        this.maxEntries = void 0 === options.maxEntries ? DEFAULT_MAX_ENTRIES : options.maxEntries;
    }
    touch = (key)=>{
        this.useTick += 1;
        this.lastUsed.set(key, this.useTick);
    };
    keyOf = (args)=>encodeCacheKey(args);
    pathOf = (args)=>`entries${PATH_SEPARATOR}${this.keyOf(args)}`;
    getEntry = (args)=>{
        const key = this.keyOf(args);
        const entry = this.data.entries[key] || getInitialCacheEntry();
        this.touch(key);
        return {
            ...entry,
            stale: this.isStale(entry)
        };
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
        if (!this.data.entries[key]) return;
        this.update((draft)=>{
            delete draft.entries[key];
        });
    };
    isStale = (entry)=>{
        if (entry.invalidated || void 0 === entry.updatedAt) return true;
        return Date.now() - entry.updatedAt > this.ttl;
    };
    isRetained = (key)=>{
        const prefix = `entries.${key}`;
        return Object.keys(this.subscribers).some((id)=>{
            const reads = this.subscribers[id].reads;
            return Array.from(reads).some((read)=>read === prefix || read.startsWith(`${prefix}${PATH_SEPARATOR}`));
        });
    };
    evict = ()=>{
        const keys = Object.keys(this.data.entries);
        if (keys.length <= this.maxEntries) return;
        const candidates = keys.filter((key)=>!this.requests.has(key) && !this.isRetained(key)).sort((left, right)=>(this.lastUsed.get(left) || 0) - (this.lastUsed.get(right) || 0));
        const excess = keys.length - this.maxEntries;
        const doomed = candidates.slice(0, excess);
        if (0 === doomed.length) return;
        doomed.forEach((key)=>{
            this.failures.delete(key);
            this.lastUsed.delete(key);
        });
        this.update((draft)=>{
            doomed.forEach((key)=>{
                delete draft.entries[key];
            });
        });
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
        const controller = new AbortController();
        this.controllers.set(key, controller);
        this.markLoading(key, deferNotification);
        const request = this.loader(args, controller.signal).then((data)=>{
            this.settleSuccess(key, controller, data);
        }, (error)=>{
            this.settleFailure(key, controller, error);
        });
        this.requests.set(key, request);
        this.evict();
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
    };
}
export { ResourceCache };
