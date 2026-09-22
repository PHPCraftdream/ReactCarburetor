import { PATH_SEPARATOR } from "../Paths/PathSeparator.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
const scopes = new WeakMap();
const covers = (invalidated, key)=>{
    if (invalidated === WILDCARD_PATH || '' === invalidated) return true;
    return key === invalidated || key.startsWith(invalidated + PATH_SEPARATOR);
};
const createProxyCache = (target)=>{
    const scope = scopes.get(target) ?? {
        revision: 0,
        invalidations: new Map()
    };
    scopes.set(target, scope);
    const entries = new Map();
    let syncedAt = scope.revision;
    const sync = ()=>{
        if (syncedAt === scope.revision) return;
        for (const [path, entry] of entries)for (const [invalidated, revision] of scope.invalidations)if (revision > entry.revision && covers(invalidated, path)) {
            entries.delete(path);
            break;
        }
        syncedAt = scope.revision;
    };
    const cache = (path, source, create)=>{
        sync();
        const entry = entries.get(path);
        if (entry && entry.source === source) return entry.proxy;
        const proxy = create();
        entries.set(path, {
            source,
            proxy,
            revision: scope.revision
        });
        return proxy;
    };
    cache.invalidate = (path)=>{
        scope.revision++;
        scope.invalidations.set(path, scope.revision);
    };
    cache.owns = (path, source)=>{
        const entry = entries.get(path);
        return void 0 !== entry && entry.source === source;
    };
    cache.size = ()=>entries.size;
    return cache;
};
export { createProxyCache };
