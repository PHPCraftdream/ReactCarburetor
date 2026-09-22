import { joinPath } from "../Paths/joinPath.mjs";
import { branchPath } from "../Paths/BranchMarker.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { isTrackable } from "./isTrackable.mjs";
const createReadProxy = (target, record, basePath = '', aliases)=>{
    const cached = createProxyCache();
    const forbidWrite = ()=>{
        throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
    };
    const proxy = new Proxy(target, {
        get: (source, key)=>{
            const value = Reflect.get(source, key, proxy);
            if ('symbol' == typeof key) return value;
            const path = joinPath(basePath, key);
            if (isTrackable(value)) {
                aliases?.note(value, path);
                record(branchPath(path));
                return cached(path, value, ()=>createReadProxy(value, record, path, aliases));
            }
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
    return proxy;
};
export { createReadProxy };
