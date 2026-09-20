import { WILDCARD_PATH, joinPath } from "./Paths.mjs";
const isTrackable = (value)=>{
    if (null === value || 'object' != typeof value) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === Array.prototype || null === prototype;
};
const cachedProxy = (cache, path, source, create)=>{
    const entry = cache.get(path);
    if (entry && entry.source === source) return entry.proxy;
    const proxy = create();
    cache.set(path, {
        source,
        proxy
    });
    return proxy;
};
const createReadProxy = (target, record, basePath = '')=>{
    const cache = new Map();
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key) return value;
            const path = joinPath(basePath, key);
            if (isTrackable(value)) return cachedProxy(cache, path, value, ()=>createReadProxy(value, record, path));
            record(path);
            return value;
        },
        has: (source, key)=>{
            if ('string' == typeof key) record(joinPath(basePath, key));
            return Reflect.has(source, key);
        },
        ownKeys: (source)=>{
            record(basePath || WILDCARD_PATH);
            return Reflect.ownKeys(source);
        },
        set: forbidWrite,
        deleteProperty: forbidWrite
    });
};
const createWriteProxy = (target, record, basePath = '')=>{
    const cache = new Map();
    const isArray = Array.isArray(target);
    const writtenPath = (key)=>isArray ? basePath || WILDCARD_PATH : joinPath(basePath, key);
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key || 'function' == typeof value || !isTrackable(value)) return value;
            const path = joinPath(basePath, key);
            return cachedProxy(cache, path, value, ()=>createWriteProxy(value, record, path));
        },
        set: (source, key, value)=>{
            if ('string' == typeof key) {
                if (Reflect.get(source, key) === value) return true;
                record(writtenPath(key));
            }
            return Reflect.set(source, key, value);
        },
        deleteProperty: (source, key)=>{
            if ('string' == typeof key) {
                if (!Reflect.has(source, key)) return true;
                record(writtenPath(key));
            }
            return Reflect.deleteProperty(source, key);
        }
    });
};
export { createReadProxy, createWriteProxy, isTrackable };
