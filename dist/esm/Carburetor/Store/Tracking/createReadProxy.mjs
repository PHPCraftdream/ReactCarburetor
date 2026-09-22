import { joinPath } from "../Paths/joinPath.mjs";
import { branchPath } from "../Paths/BranchMarker.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { IS_DEVELOPMENT } from "../Utils/DevelopmentFlag.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { PROXY_CACHE } from "./Models.mjs";
import { liveViews } from "./liveViews.mjs";
import { isTrackable } from "./isTrackable.mjs";
const createReadProxy = (target, record, basePath = '', aliases)=>{
    const cached = createProxyCache(target);
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    const lockedError = (path)=>new Error('Carburetor: read-only tracking cannot wrap "' + path + '" — the property is non-configurable and non-writable (freeze or seal does this), and the engine accepts only the raw object there, which nothing would track or guard. Keep store data unfrozen; snapshot() is the detached form.');
    const lockedAgainstWrapping = (source, key, own)=>{
        const descriptor = own ?? (IS_DEVELOPMENT || !Object.isExtensible(source) ? Reflect.getOwnPropertyDescriptor(source, key) : void 0);
        return void 0 !== descriptor && !descriptor.configurable && false === descriptor.writable;
    };
    const proxy = new Proxy(target, {
        get: (source, key)=>{
            if (key === PROXY_CACHE) return cached;
            cached.sweep();
            const value = Reflect.get(source, key, proxy);
            if ('symbol' == typeof key) return value;
            const path = joinPath(basePath, key);
            if (isTrackable(value)) {
                aliases?.note(value, path);
                record(branchPath(path));
                if (lockedAgainstWrapping(source, key)) {
                    if (IS_DEVELOPMENT) throw lockedError(path);
                    return value;
                }
                return cached(path, value, ()=>createReadProxy(value, record, path, aliases));
            }
            record(path);
            return value;
        },
        has: (source, key)=>{
            cached.sweep();
            if ('string' == typeof key) record(joinPath(basePath, key));
            return Reflect.has(source, key);
        },
        ownKeys: (source)=>{
            cached.sweep();
            record(basePath || WILDCARD_PATH);
            return Reflect.ownKeys(source);
        },
        getOwnPropertyDescriptor: (source, key)=>{
            cached.sweep();
            const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
            if (void 0 === descriptor || 'symbol' == typeof key) return descriptor;
            const path = joinPath(basePath, key);
            const value = descriptor.value;
            if (isTrackable(value)) {
                if (lockedAgainstWrapping(source, key, descriptor)) {
                    if (IS_DEVELOPMENT) throw lockedError(path);
                    return descriptor;
                }
                descriptor.value = cached(path, value, ()=>createReadProxy(value, record, path, aliases));
            }
            return descriptor;
        },
        set: forbidWrite,
        defineProperty: forbidWrite,
        deleteProperty: forbidWrite
    });
    liveViews.note(proxy);
    return proxy;
};
export { createReadProxy };
