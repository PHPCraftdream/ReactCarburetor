import { PATCH_ABSENT, PATCH_OPAQUE } from "../../Models/Paths.mjs";
import { diffPaths } from "../Paths/Diff/diffPaths.mjs";
import { joinPath } from "../Paths/joinPath.mjs";
import { keysPath } from "../Paths/Markers/KeysMarker.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { deepClone } from "../Utils/deepClone.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { PROXY_CACHE } from "./Models.mjs";
import { isTrackable } from "./isTrackable.mjs";
const patchValue = (value)=>isTrackable(value) ? deepClone(value) : value;
const proxyTargets = new WeakMap();
const unwrapWriteProxy = (value)=>{
    if (null === value || 'object' != typeof value) return value;
    const target = proxyTargets.get(value);
    return target ?? value;
};
class WriteProxyHandler {
    basePath;
    record;
    aliases;
    cache;
    isArray;
    patchPort;
    basePathSegments;
    constructor(basePath, record, aliases, cache, isArray, patchPort, basePathSegments){
        this.basePath = basePath;
        this.record = record;
        this.aliases = aliases;
        this.cache = cache;
        this.isArray = isArray;
        this.patchPort = patchPort;
        this.basePathSegments = basePathSegments;
    }
    childPaths;
    keysMarkerPath;
    keysMarker() {
        return this.keysMarkerPath ?? (this.keysMarkerPath = keysPath(this.basePath));
    }
    writtenPath(key) {
        if ('symbol' == typeof key || this.basePath === WILDCARD_PATH) return WILDCARD_PATH;
        const memo = this.childPaths ?? (this.childPaths = new Map());
        let path = memo.get(key);
        if (void 0 === path) {
            path = joinPath(this.basePath, key);
            memo.set(key, path);
        }
        return path;
    }
    reportPatch(listener, key, previous, next) {
        listener({
            segments: [
                ...this.basePathSegments,
                key
            ],
            previous: patchValue(previous),
            next: patchValue(next)
        });
    }
    wrap(path, key, source) {
        const cached = this.cache.get(path, source);
        if (void 0 !== cached) return cached;
        const segments = 'string' == typeof key ? [
            ...this.basePathSegments,
            key
        ] : this.basePathSegments;
        const proxy = createWriteProxy(source, this.record, path, this.aliases, this.cache, this.patchPort, segments);
        this.cache.set(path, source, proxy);
        return proxy;
    }
    get(source, key) {
        if (key === PROXY_CACHE) return this.cache;
        const value = Reflect.get(source, key);
        if ('function' == typeof value) return value;
        if (isTrackable(value)) return this.wrap(this.writtenPath(key), key, value);
        if (null !== value && 'object' == typeof value) {
            var _this_patchPort_listener, _this_patchPort;
            null == (_this_patchPort = this.patchPort) || null == (_this_patchPort_listener = _this_patchPort.listener) || _this_patchPort_listener.call(_this_patchPort, PATCH_OPAQUE);
            this.record(this.writtenPath(key));
        }
        return value;
    }
    set(source, key, value) {
        var _this_aliases, _this_aliases1, _this_patchPort;
        const previous = Reflect.get(source, key);
        const raw = unwrapWriteProxy(value);
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);
        if (wasOwn && Object.is(previous, raw)) return true;
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        const path = this.writtenPath(key);
        if (listener && path === WILDCARD_PATH) listener(PATCH_OPAQUE);
        if (!wasOwn && 'string' == typeof key && this.basePath !== WILDCARD_PATH) this.record(this.keysMarker());
        if (this.isArray && 'length' === key && 'number' == typeof raw && 'number' == typeof previous && raw < previous) {
            for(let removed = raw; removed < previous; removed++){
                const removedKey = String(removed);
                const removedPath = joinPath(this.basePath, removedKey);
                if (listener) this.reportPatch(listener, removedKey, Reflect.get(source, removedKey), PATCH_ABSENT);
                this.record(removedPath);
            }
            if (this.basePath !== WILDCARD_PATH) this.record(this.keysMarker());
        }
        const previousLength = this.isArray && 'string' == typeof key && 'length' !== key ? source.length : void 0;
        if (wasOwn && isTrackable(previous) && isTrackable(raw) && Array.isArray(previous) === Array.isArray(raw)) {
            const onPatch = listener && path !== WILDCARD_PATH ? listener : void 0;
            const segments = onPatch ? [
                ...this.basePathSegments,
                key
            ] : [];
            diffPaths(previous, raw, path, segments, onPatch).forEach((changed)=>this.record(changed));
        } else {
            if (listener && path !== WILDCARD_PATH) this.reportPatch(listener, key, wasOwn ? previous : PATCH_ABSENT, raw);
            this.record(path);
        }
        const wrote = Reflect.set(source, key, raw);
        if (void 0 !== previousLength && source.length !== previousLength) {
            const newLength = source.length;
            if (listener) this.reportPatch(listener, 'length', previousLength, newLength);
            this.record(this.writtenPath('length'));
        }
        return wrote;
    }
    defineProperty(source, key, descriptor) {
        var _this_aliases, _this_aliases1, _this_patchPort;
        const previous = Reflect.get(source, key);
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        if (!wasOwn && 'string' == typeof key && this.basePath !== WILDCARD_PATH) this.record(this.keysMarker());
        const path = this.writtenPath(key);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) if (path === WILDCARD_PATH) listener(PATCH_OPAQUE);
        else this.reportPatch(listener, key, wasOwn ? previous : PATCH_ABSENT, descriptor.value);
        this.record(path);
        return Reflect.defineProperty(source, key, descriptor);
    }
    deleteProperty(source, key) {
        var _this_aliases, _this_aliases1, _this_patchPort;
        if (!Reflect.has(source, key)) return true;
        const previous = Reflect.get(source, key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        if ('string' == typeof key && this.basePath !== WILDCARD_PATH) this.record(this.keysMarker());
        const path = this.writtenPath(key);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) if (path === WILDCARD_PATH) listener(PATCH_OPAQUE);
        else this.reportPatch(listener, key, previous, PATCH_ABSENT);
        this.record(path);
        return Reflect.deleteProperty(source, key);
    }
}
const createWriteProxy = (target, record, basePath = '', aliases, cache, patchPort, basePathSegments = [])=>{
    const cached = cache ?? createProxyCache();
    const handler = new WriteProxyHandler(basePath, record, aliases, cached, Array.isArray(target), patchPort, basePathSegments);
    const proxy = new Proxy(target, handler);
    proxyTargets.set(proxy, target);
    return proxy;
};
export { createWriteProxy };
