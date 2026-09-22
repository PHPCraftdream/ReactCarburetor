import { joinPath } from "../Paths/joinPath.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { isTrackable } from "./isTrackable.mjs";
const proxyTargets = new WeakMap();
const unwrapWriteProxy = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    const target = proxyTargets.get(value);
    return target ?? value;
};
const createWriteProxy = (target, record, basePath = '', aliases)=>{
    const cached = createProxyCache();
    const isArray = Array.isArray(target);
    const writtenPath = (key)=>{
        if ('symbol' == typeof key) return WILDCARD_PATH;
        return isArray ? basePath || WILDCARD_PATH : joinPath(basePath, key);
    };
    const proxy = new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key || 'function' == typeof value) return value;
            const path = joinPath(basePath, key);
            if (isTrackable(value)) return cached(path, value, ()=>createWriteProxy(value, record, path, aliases));
            if (null !== value && 'object' == typeof value) record(path);
            return value;
        },
        set: (source, key, value)=>{
            const previous = Reflect.get(source, key);
            const raw = unwrapWriteProxy(value);
            if (previous === raw) return true;
            aliases?.checkWrite(source, basePath);
            aliases?.forget(previous);
            record(writtenPath(key));
            return Reflect.set(source, key, raw);
        },
        defineProperty: (source, key, descriptor)=>{
            aliases?.checkWrite(source, basePath);
            aliases?.forget(Reflect.get(source, key));
            record(writtenPath(key));
            return Reflect.defineProperty(source, key, descriptor);
        },
        deleteProperty: (source, key)=>{
            if (!Reflect.has(source, key)) return true;
            aliases?.checkWrite(source, basePath);
            aliases?.forget(Reflect.get(source, key));
            record(writtenPath(key));
            return Reflect.deleteProperty(source, key);
        }
    });
    proxyTargets.set(proxy, target);
    return proxy;
};
export { createWriteProxy };
