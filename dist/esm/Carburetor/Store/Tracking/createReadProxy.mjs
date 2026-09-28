import { joinPath } from "../Paths/joinPath.mjs";
import { branchPath } from "../Paths/Markers/BranchMarker.mjs";
import { keysPath } from "../Paths/Markers/KeysMarker.mjs";
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
    firstKey = void 0;
    firstPath = '';
    childPaths = void 0;
    firstBranch = void 0;
    firstMarker = '';
    branchMarkers = void 0;
    keysMarkerPath = void 0;
    childPath(key) {
        if (key === this.firstKey) return this.firstPath;
        if (void 0 === this.firstKey) {
            this.firstKey = key;
            this.firstPath = joinPath(this.basePath, key);
            return this.firstPath;
        }
        const memo = this.childPaths ?? (this.childPaths = new Map());
        let path = memo.get(key);
        if (void 0 === path) {
            path = joinPath(this.basePath, key);
            memo.set(key, path);
        }
        return path;
    }
    branchMarker(path) {
        if (path === this.firstBranch) return this.firstMarker;
        if (void 0 === this.firstBranch) {
            this.firstBranch = path;
            this.firstMarker = branchPath(path);
            return this.firstMarker;
        }
        const memo = this.branchMarkers ?? (this.branchMarkers = new Map());
        let marker = memo.get(path);
        if (void 0 === marker) {
            marker = branchPath(path);
            memo.set(path, marker);
        }
        return marker;
    }
    keysMarker() {
        return this.keysMarkerPath ?? (this.keysMarkerPath = keysPath(this.basePath));
    }
    wrap(path, source) {
        const cached = this.cache.get(path, source);
        if (void 0 !== cached) return cached;
        const proxy = createReadProxy(source, this.record, path, this.aliases, this.cache);
        this.cache.set(path, source, proxy);
        return proxy;
    }
    get(source, key, receiver) {
        if (key === PROXY_CACHE) return this.cache;
        const value = Reflect.get(source, key, receiver);
        if (!isRecordable(source, key)) return value;
        if ('symbol' == typeof key) {
            if (!isTrackable(value)) return value;
            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) throw lockedError(String(key));
                return value;
            }
            return this.wrap(WILDCARD_PATH, value);
        }
        const path = this.childPath(key);
        if (isTrackable(value)) {
            var _this_aliases;
            null == (_this_aliases = this.aliases) || _this_aliases.note(value, path);
            this.record(this.branchMarker(path));
            if (lockedAgainstWrapping(source, key)) {
                if (IS_DEVELOPMENT) throw lockedError(path);
                return value;
            }
            return this.wrap(path, value);
        }
        this.record(path);
        return value;
    }
    has(source, key) {
        const present = Reflect.has(source, key);
        if ('string' == typeof key && isRecordable(source, key)) {
            const path = this.childPath(key);
            const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
            const value = void 0 !== descriptor && 'value' in descriptor ? descriptor.value : void 0;
            this.record(isTrackable(value) ? this.branchMarker(path) : path);
        }
        return present;
    }
    ownKeys(source) {
        this.record(this.keysMarker());
        return Reflect.ownKeys(source);
    }
    getOwnPropertyDescriptor(source, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(source, key);
        if (void 0 === descriptor) return descriptor;
        if ('symbol' == typeof key) {
            const symbolValue = descriptor.value;
            if (isTrackable(symbolValue)) {
                if (lockedAgainstWrapping(source, key, descriptor)) {
                    if (IS_DEVELOPMENT) throw lockedError(String(key));
                    return descriptor;
                }
                descriptor.value = this.wrap(WILDCARD_PATH, symbolValue);
            }
            return descriptor;
        }
        const path = this.childPath(key);
        const value = descriptor.value;
        if (isTrackable(value)) {
            if (lockedAgainstWrapping(source, key, descriptor)) {
                if (IS_DEVELOPMENT) throw lockedError(path);
                return descriptor;
            }
            descriptor.value = this.wrap(path, value);
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
