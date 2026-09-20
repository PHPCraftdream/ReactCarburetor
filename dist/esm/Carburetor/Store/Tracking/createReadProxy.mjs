import { joinPath } from "../Paths/joinPath.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { isTrackable } from "./isTrackable.mjs";
const createReadProxy = (target, record, basePath = '')=>{
    const cached = createProxyCache();
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    return new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key);
            if ('symbol' == typeof key) return value;
            const path = joinPath(basePath, key);
            if (isTrackable(value)) return cached(path, value, ()=>createReadProxy(value, record, path));
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
export { createReadProxy };
