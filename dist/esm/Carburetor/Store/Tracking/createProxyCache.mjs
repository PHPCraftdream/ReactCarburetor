import { PATH_SEPARATOR } from "../Paths/PathSeparator.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
const scopes = new WeakMap();
const WEAK_REF_MISSING_MESSAGE = "Carburetor: this environment has no global WeakRef, which the proxy cache requires to track live views without pinning obsolete data. WeakRef shipped in Node 14.6+ and in every evergreen browser since 2021 — see https://caniuse.com/mdn-javascript_builtins_weakref for supported browser versions, or run this build only where WeakRef is available.";
const covers = (invalidated, key)=>{
    if (invalidated === WILDCARD_PATH || '' === invalidated) return true;
    return key === invalidated || key.startsWith(invalidated + PATH_SEPARATOR);
};
const needsRecord = (state, record)=>{
    for (const [path, entry] of state.entries)if (entry.revision < record.revision && covers(record.path, path)) return true;
    return false;
};
const createProxyCache = (target)=>{
    if ("u" < typeof WeakRef) throw new Error(WEAK_REF_MISSING_MESSAGE);
    const scope = scopes.get(target) ?? {
        revision: 0,
        records: new Map(),
        watchers: new Set(),
        visitedRecords: 0
    };
    scopes.set(target, scope);
    const state = {
        syncedAt: scope.revision,
        entries: new Map()
    };
    const watcherRef = new WeakRef(state);
    const retire = ()=>{
        for (const watcher of scope.watchers){
            const watched = watcher.deref();
            if (void 0 === watched || 0 === watched.entries.size) scope.watchers.delete(watcher);
        }
        let sweptThrough = scope.revision;
        for (const watcher of scope.watchers){
            const watched = watcher.deref();
            if (void 0 !== watched && watched.syncedAt < sweptThrough) sweptThrough = watched.syncedAt;
        }
        for (const [path, record] of scope.records){
            scope.visitedRecords++;
            if (record.revision <= sweptThrough) {
                scope.records.delete(path);
                continue;
            }
            let stillNeeded = false;
            for (const watcher of scope.watchers){
                const watched = watcher.deref();
                if (void 0 !== watched && watched.syncedAt < record.revision && needsRecord(watched, record)) {
                    stillNeeded = true;
                    break;
                }
            }
            if (!stillNeeded) scope.records.delete(path);
        }
    };
    retire();
    scope.watchers.add(watcherRef);
    const sweep = ()=>{
        if (state.syncedAt === scope.revision) return;
        const applied = state.syncedAt;
        state.syncedAt = scope.revision;
        for (const record of scope.records.values())if (!(record.revision <= applied)) {
            for (const [path, entry] of state.entries)if (entry.revision < record.revision && covers(record.path, path)) state.entries.delete(path);
        }
        retire();
    };
    const cache = (path, source, create)=>{
        sweep();
        const entry = state.entries.get(path);
        if (entry && entry.source === source) return entry.proxy;
        const proxy = create();
        state.entries.set(path, {
            source,
            proxy,
            revision: scope.revision
        });
        scope.watchers.add(watcherRef);
        return proxy;
    };
    cache.invalidate = (path)=>{
        scope.revision++;
        scope.records.set(path, {
            path,
            revision: scope.revision
        });
        retire();
    };
    cache.sweep = sweep;
    cache.release = ()=>{
        scope.watchers.delete(watcherRef);
        retire();
    };
    cache.owns = (path, source)=>{
        const entry = state.entries.get(path);
        return void 0 !== entry && entry.source === source;
    };
    cache.size = ()=>state.entries.size;
    cache.pending = ()=>scope.records.size;
    cache.visitedRecords = ()=>scope.visitedRecords;
    cache.watcherCount = ()=>scope.watchers.size;
    return cache;
};
export { createProxyCache };
