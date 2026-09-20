import { joinPath } from "../Paths/joinPath.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { isTrackable } from "./isTrackable.mjs";
const createWriteProxy = (target, record, basePath = '')=>{
    const cached = createProxyCache();
    const isArray = Array.isArray(target);
    const writtenPath = (key)=>{
        if ('symbol' == typeof key) return WILDCARD_PATH;
        return isArray ? basePath || WILDCARD_PATH : joinPath(basePath, key);
    };
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key || 'function' == typeof value) return value;
            const path = joinPath(basePath, key);
            if (isTrackable(value)) return cached(path, value, ()=>createWriteProxy(value, record, path));
            if (null !== value && 'object' == typeof value) record(path);
            return value;
        },
        set: (source, key, value)=>{
            if (Reflect.get(source, key) === value) return true;
            record(writtenPath(key));
            return Reflect.set(source, key, value);
        },
        defineProperty: (source, key, descriptor)=>{
            record(writtenPath(key));
            return Reflect.defineProperty(source, key, descriptor);
        },
        deleteProperty: (source, key)=>{
            if (!Reflect.has(source, key)) return true;
            record(writtenPath(key));
            return Reflect.deleteProperty(source, key);
        }
    });
};
export { createWriteProxy };
