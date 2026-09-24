import { EResourceStatus } from "../../Models/Enums/EResourceStatus.mjs";
import { Carburetor } from "../../Store/Carburetor.mjs";
import { PATH_SEPARATOR } from "../../Store/Paths/PathSeparator.mjs";
import { joinPath } from "../../Store/Paths/joinPath.mjs";
import { deepClone } from "../../Store/Utils/deepClone.mjs";
import { describeError } from "../describeError.mjs";
import { createAbortHandle } from "../createAbortHandle.mjs";
import { getInitialCacheEntry } from "./getInitialCacheEntry.mjs";
const DEFAULT_TTL = 30000;
const DEFAULT_MAX_ENTRIES = 100;
const ENTRIES_PREFIX = `entries${PATH_SEPARATOR}`;
class ResourceCacheLifecycle extends Carburetor {
    loader;
    restoreGeneration = 0;
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
        const generation = ++this.restoreGeneration;
        const controllers = Array.from(this.controllers.entries());
        this.controllers.clear();
        this.requests.clear();
        this.failures.clear();
        this.viewCache.clear();
        this.lastUsed.clear();
        controllers.forEach(([, controller])=>controller.abort());
        if (generation !== this.restoreGeneration) return;
        const entries = {};
        Object.keys(data.entries).forEach((key)=>{
            const entry = data.entries[key];
            entries[key] = {
                ...entry,
                refreshing: false,
                status: entry.status === EResourceStatus.Pending ? EResourceStatus.Idle : entry.status
            };
        });
        this.controllers.forEach((_controller, key)=>{
            const entry = this.data.entries[key];
            if (entry) entries[key] = entry;
        });
        this.setData(deepClone({
            entries
        }));
    };
    touch = (key)=>{
        this.useTick += 1;
        this.lastUsed.set(key, this.useTick);
    };
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
        if (this.controllers.get(key) === controller) {
            this.controllers.delete(key);
            this.requests.delete(key);
        }
        controller.abort();
        if (this.controllers.has(key)) return;
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
        if (entry && entry.status === EResourceStatus.Success) return entry.data;
        if (entry && entry.status === EResourceStatus.Error) throw this.failures.has(key) ? this.failures.get(key) : new Error(entry.error || 'Carburetor: resource failed');
        const known = this.requests.get(key);
        throw known || this.fetch(key, args, true);
    };
    fetch = (key, args, deferNotification = false)=>{
        const known = this.requests.get(key);
        if (known) return known;
        const controller = createAbortHandle();
        let resolveRequest = ()=>void 0;
        let rejectRequest = ()=>void 0;
        const request = new Promise((resolve, reject)=>{
            resolveRequest = resolve;
            rejectRequest = reject;
        });
        this.controllers.set(key, controller);
        this.requests.set(key, request);
        this.markLoading(key, deferNotification);
        if (!this.isCurrent(key, controller)) {
            resolveRequest();
            return request;
        }
        let answer;
        try {
            answer = this.loader(args, controller.signal);
        } catch (error) {
            answer = Promise.reject(error);
        }
        answer.then((data)=>{
            this.settleSuccess(key, controller, data);
        }, (error)=>{
            this.settleFailure(key, controller, error);
        }).then(resolveRequest, rejectRequest);
        this.evict(deferNotification);
        return request;
    };
    markLoading = (key, deferNotification)=>{
        const entry = this.data.entries[key];
        const draft = this.draft;
        if (entry) if (entry.status !== EResourceStatus.Success) {
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
        const entry = this.data.entries[key];
        const hasData = entry.status === EResourceStatus.Success || void 0 !== entry.data;
        this.update((draft)=>{
            draft.entries[key].error = describeError(error);
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = true;
            if (!hasData) draft.entries[key].status = EResourceStatus.Error;
        });
        this.evict();
    };
}
export { ResourceCacheLifecycle };
