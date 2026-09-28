import { joinPath } from "../Paths/joinPath.mjs";
import { branchPath } from "../Paths/BranchMarker.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { IS_DEVELOPMENT } from "../Utils/DevelopmentFlag.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { PROXY_CACHE } from "./Models.mjs";
import { liveViews } from "./liveViews.mjs";
import { isTrackable } from "./isTrackable.mjs";
const isRecordable = (source, key)=>Object.prototype.hasOwnProperty.call(source, key) || !(key in source);
const forbidWrite = ()=>{
    throw new Error("Carburetor: data read through useCarburetor is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
};
const lockedError = (path)=>new Error('Carburetor: read-only tracking cannot wrap "' + path + '" — the property is non-configurable and non-writable (freeze or seal does this), and the engine accepts only the raw object there, which nothing would track or guard. Keep store data unfrozen; snapshot() is the detached form.');
const lockedAgainstWrapping = (source, key, own)=>{
    const descriptor = own ?? (IS_DEVELOPMENT || !Object.isExtensible(source) ? Reflect.getOwnPropertyDescriptor(source, key) : void 0);
    return void 0 !== descriptor && !descriptor.configurable && false === descriptor.writable;
};
class ReadProxyHandler {
    basePath;
    record;
    aliases;
    cache;
    constructor(basePath, record, aliases, cache){
        this.basePath = basePath;
        this.record = record;
        this.aliases = aliases;
        this.cache = cache;
    }
    get(source, key, receiver) {
        if (key === PROXY_CACHE) return this.cache;
        const value = Reflect.get(source, key, receiver);
        if (!isRecordable(source, key)) return value;
        if ('symbol' == typeof key) {
            this.record(WILDCARD_PATH);
            if (!isTrackable(value)) return value;
            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) throw lockedError(String(key));
                return value;
            }
            return this.cache(WILDCARD_PATH, value, ()=>createReadProxy(value, this.record, WILDCARD_PATH, this.aliases, this.cache));
        }
        const path = joinPath(this.basePath, key);
        if (isTrackable(value)) {
            var _this_aliases;
            null == (_this_aliases = this.aliases) || _this_aliases.note(value, path);
            this.record(branchPath(path));
            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) throw lockedError(path);
                return value;
            }
            return this.cache(path, value, ()=>createReadProxy(value, this.record, path, this.aliases, this.cache));
        }
        this.record(path);
        return value;
    }
    has(source, key) {
        const present = Reflect.has(source, key);
        if ('string' == typeof key && isRecordable(source, key)) {
            const path = joinPath(this.basePath, key);
            const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
            const value = void 0 !== descriptor && 'value' in descriptor ? descriptor.value : void 0;
            this.record(isTrackable(value) ? branchPath(path) : path);
        }
        return present;
    }
    ownKeys(source) {
        this.record(this.basePath || WILDCARD_PATH);
        return Reflect.ownKeys(source);
    }
    getOwnPropertyDescriptor(source, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
        if (void 0 === descriptor) return descriptor;
        if ('symbol' == typeof key) {
            this.record(WILDCARD_PATH);
            const symbolValue = descriptor.value;
            if (isTrackable(symbolValue)) {
                if (lockedAgainstWrapping(source, key, descriptor)) {
                    if (IS_DEVELOPMENT) throw lockedError(String(key));
                    return descriptor;
                }
                descriptor.value = this.cache(WILDCARD_PATH, symbolValue, ()=>createReadProxy(symbolValue, this.record, WILDCARD_PATH, this.aliases, this.cache));
            }
            return descriptor;
        }
        const path = joinPath(this.basePath, key);
        const value = descriptor.value;
        if (isTrackable(value)) {
            if (lockedAgainstWrapping(source, key, descriptor)) {
                if (IS_DEVELOPMENT) throw lockedError(path);
                return descriptor;
            }
            descriptor.value = this.cache(path, value, ()=>createReadProxy(value, this.record, path, this.aliases, this.cache));
        }
        return descriptor;
    }
    setPrototypeOf() {
        return forbidWrite();
    }
    preventExtensions() {
        return forbidWrite();
    }
    set() {
        return forbidWrite();
    }
    defineProperty() {
        return forbidWrite();
    }
    deleteProperty() {
        return forbidWrite();
    }
}
const createReadProxy = (target, record, basePath = '', aliases, cache)=>{
    const cached = cache ?? createProxyCache();
    const proxy = new Proxy(target, new ReadProxyHandler(basePath, record, aliases, cached));
    if (IS_DEVELOPMENT) liveViews.note(proxy);
    return proxy;
};
export { createReadProxy };
