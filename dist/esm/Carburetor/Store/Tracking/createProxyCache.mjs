import { PATH_SEPARATOR } from "../Paths/PathSeparator.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
const scopes = new WeakMap();
const covers = (invalidated, key)=>{
    if (invalidated === WILDCARD_PATH || '' === invalidated) return true;
    return key === invalidated || key.startsWith(invalidated + PATH_SEPARATOR);
};
const needsRecord = (state, record)=>{
    for (const [path, entry] of state.entries)if (entry.revision < record.revision && covers(record.path, path)) return true;
    return false;
};
const createProxyCache = (target)=>{
    const scope = scopes.get(target) ?? {
        revision: 0,
        records: [],
        watchers: new Set()
    };
    scopes.set(target, scope);
    const state = {
        syncedAt: scope.revision,
        entries: new Map()
    };
    scope.watchers.add(new WeakRef(state));
    const retire = (precise)=>{
        for (const watcher of scope.watchers)if (void 0 === watcher.deref()) scope.watchers.delete(watcher);
        let sweptThrough = scope.revision;
        for (const watcher of scope.watchers){
            const watched = watcher.deref();
            if (void 0 !== watched && watched.syncedAt < sweptThrough) sweptThrough = watched.syncedAt;
        }
        scope.records = scope.records.filter((record)=>{
            if (record.revision <= sweptThrough) return false;
            if (!precise) return true;
            for (const watcher of scope.watchers){
                const watched = watcher.deref();
                if (void 0 !== watched && watched.syncedAt < record.revision && needsRecord(watched, record)) return true;
            }
            return false;
        });
    };
    const sweep = ()=>{
        if (state.syncedAt === scope.revision) return;
        const applied = state.syncedAt;
        state.syncedAt = scope.revision;
        for (const record of scope.records)if (!(record.revision <= applied)) {
            for (const [path, entry] of state.entries)if (entry.revision < record.revision && covers(record.path, path)) state.entries.delete(path);
        }
        retire(true);
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
        return proxy;
    };
    cache.invalidate = (path)=>{
        scope.revision++;
        scope.records.push({
            path,
            revision: scope.revision
        });
        retire(false);
    };
    cache.sweep = sweep;
    cache.owns = (path, source)=>{
        const entry = state.entries.get(path);
        return void 0 !== entry && entry.source === source;
    };
    cache.size = ()=>state.entries.size;
    cache.pending = ()=>scope.records.length;
    return cache;
};
export { createProxyCache };
