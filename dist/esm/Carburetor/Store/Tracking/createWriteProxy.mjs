import { joinPath } from "../Paths/joinPath.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { isTrackable } from "./isTrackable.mjs";
const createWriteProxy = (target, record, basePath = '')=>{
    const cached = createProxyCache();
    const isArray = Array.isArray(target);
    const writtenPath = (key)=>isArray ? basePath || WILDCARD_PATH : joinPath(basePath, key);
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key || 'function' == typeof value || !isTrackable(value)) return value;
            const path = joinPath(basePath, key);
            return cached(path, value, ()=>createWriteProxy(value, record, path));
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
export { createWriteProxy };
