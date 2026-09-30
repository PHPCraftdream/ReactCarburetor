import { PATCH_ABSENT, PATCH_OPAQUE } from "../../Models/Paths.mjs";
import { diffPaths } from "../Paths/Diff/diffPaths.mjs";
import { joinPath } from "../Paths/joinPath.mjs";
import { keysPath } from "../Paths/Markers/KeysMarker.mjs";
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
const forbidSymbolKey = (path)=>{
    throw new Error('Carburetor: "' + (path || 'the root') + '" cannot take a symbol-keyed write — state is string-keyed data only. Use a string key.');
};
const isOpaqueDescriptor = (descriptor, existing)=>'get' in descriptor || 'set' in descriptor || (descriptor.configurable ?? (null == existing ? void 0 : existing.configurable)) !== true || (descriptor.writable ?? (null == existing ? void 0 : existing.writable)) !== true || (descriptor.enumerable ?? (null == existing ? void 0 : existing.enumerable)) !== true;
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
        const memo = this.childPaths ?? (this.childPaths = new Map());
        let path = memo.get(key);
        if (void 0 === path) {
            path = joinPath(this.basePath, key);
            memo.set(key, path);
        }
        return path;
    }
    reportPatch(listener, key, previous, next) {
        var _this_patchPort;
        if (null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.opaque) return void listener(PATCH_OPAQUE);
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
        const segments = [
            ...this.basePathSegments,
            key
        ];
        const proxy = createWriteProxy(source, this.record, path, this.aliases, this.cache, this.patchPort, segments);
        this.cache.set(path, source, proxy);
        return proxy;
    }
    setArrayLength(source, value, descriptor) {
        var _Object_getOwnPropertyDescriptor, _this_patchPort, _this_patchPort1;
        const validNumber = 'number' == typeof value && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
        if (!descriptor && !validNumber && (null == (_Object_getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor(source, 'length')) ? void 0 : _Object_getOwnPropertyDescriptor.writable) === false) return Reflect.set(source, 'length', value);
        const uint32 = validNumber ? value : value >>> 0;
        if (!validNumber && uint32 !== +value) throw new RangeError('Invalid array length');
        const array = source;
        const previousLength = array.length;
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        const concrete = !listener || (null == (_this_patchPort1 = this.patchPort) ? void 0 : _this_patchPort1.opaque) ? void 0 : listener;
        let removed;
        let removedValues;
        let removedAny = false;
        let denseStart;
        if (uint32 < previousLength) {
            const range = previousLength - uint32;
            if (!concrete && range >= 64 && range <= 4096) {
                const ownKeys = Object.keys(array);
                if (ownKeys.length === previousLength && ownKeys[previousLength - 1] === String(previousLength - 1)) denseStart = uint32;
            }
            if (void 0 === denseStart) {
                removed = [];
                if (concrete) removedValues = [];
                if (range <= 4096) {
                    for(let index = uint32; index < previousLength; index++)if (Object.prototype.hasOwnProperty.call(array, index)) {
                        removed.push(index);
                        null == removedValues || removedValues.push(array[index]);
                    }
                } else for (const key of Object.keys(array)){
                    const index = Number(key);
                    if (Number.isInteger(index) && index >= uint32 && index < previousLength && String(index) === key) {
                        removed.push(key);
                        null == removedValues || removedValues.push(array[index]);
                    }
                }
            }
        }
        const wrote = descriptor ? Reflect.defineProperty(source, 'length', {
            ...descriptor,
            value: uint32
        }) : Reflect.set(source, 'length', uint32);
        const nextLength = array.length;
        if (void 0 !== denseStart) {
            for(let index = denseStart; index < previousLength; index++)if (wrote || !Object.prototype.hasOwnProperty.call(array, index)) {
                removedAny = true;
                this.record(joinPath(this.basePath, String(index)));
            }
        }
        if (removed) for(let i = 0; i < removed.length; i++){
            const entry = removed[i];
            if (!wrote && Object.prototype.hasOwnProperty.call(array, entry)) continue;
            removedAny = true;
            const key = String(entry);
            this.record(joinPath(this.basePath, key));
            if (concrete) this.reportPatch(concrete, key, null == removedValues ? void 0 : removedValues[i], PATCH_ABSENT);
        }
        if (removedAny) {
            var _this_aliases;
            null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
            this.record(this.keysMarker());
        }
        if (nextLength !== previousLength) {
            var _this_aliases1;
            null == (_this_aliases1 = this.aliases) || _this_aliases1.checkWrite(source, this.basePath);
            this.record(this.writtenPath('length'));
            if (concrete) this.reportPatch(concrete, 'length', previousLength, nextLength);
        }
        if (listener && !concrete && (removedAny || nextLength !== previousLength)) listener(PATCH_OPAQUE);
        return wrote;
    }
    get(source, key) {
        if ('symbol' == typeof key) return key === PROXY_CACHE ? this.cache : Reflect.get(source, key);
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
        var _this_aliases, _this_aliases1, _this_aliases2, _this_aliases3, _this_patchPort;
        if ('symbol' == typeof key) return forbidSymbolKey(this.basePath);
        const previous = Reflect.get(source, key);
        const raw = unwrapWriteProxy(value);
        const wasOwn = Object.prototype.hasOwnProperty.call(source, key);
        if (this.isArray && 'length' === key) return this.setArrayLength(source, raw);
        if (wasOwn && Object.is(previous, raw)) return true;
        const path = this.writtenPath(key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkKey(source, key, path);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.checkState(raw, path, wasOwn ? previous : void 0);
        null == (_this_aliases2 = this.aliases) || _this_aliases2.checkWrite(source, this.basePath);
        const protoWrite = '__proto__' === key;
        const previousLength = this.isArray && 'length' !== key ? source.length : void 0;
        const wrote = protoWrite ? Reflect.defineProperty(source, key, {
            value: raw,
            writable: true,
            enumerable: true,
            configurable: true
        }) : Reflect.set(source, key, raw);
        if (!wrote) return false;
        null == (_this_aliases3 = this.aliases) || _this_aliases3.forget(previous);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (!wasOwn) this.record(this.keysMarker());
        if (wasOwn && isTrackable(previous) && isTrackable(raw) && Array.isArray(previous) === Array.isArray(raw)) {
            var _this_patchPort1;
            const concrete = !listener || (null == (_this_patchPort1 = this.patchPort) ? void 0 : _this_patchPort1.opaque) ? void 0 : listener;
            const segments = concrete ? [
                ...this.basePathSegments,
                key
            ] : [];
            const changed = diffPaths(previous, raw, path, segments, concrete);
            if (listener && !concrete && changed.size > 0) listener(PATCH_OPAQUE);
            changed.forEach((written)=>this.record(written));
        } else {
            if (listener) this.reportPatch(listener, key, wasOwn ? previous : PATCH_ABSENT, raw);
            this.record(path);
        }
        if (void 0 !== previousLength && source.length !== previousLength) {
            const newLength = source.length;
            if (listener) this.reportPatch(listener, 'length', previousLength, newLength);
            this.record(this.writtenPath('length'));
        }
        return true;
    }
    defineProperty(source, key, descriptor) {
        var _this_aliases, _this_aliases1, _this_aliases2, _this_aliases3, _this_patchPort;
        if ('symbol' == typeof key) return forbidSymbolKey(this.basePath);
        if (this.isArray && 'length' === key) return 'value' in descriptor ? this.setArrayLength(source, descriptor.value, descriptor) : Reflect.defineProperty(source, key, descriptor);
        const fullyOpen = true === descriptor.configurable && true === descriptor.writable && true === descriptor.enumerable;
        const existing = fullyOpen ? void 0 : Object.getOwnPropertyDescriptor(source, key);
        const wasOwn = fullyOpen ? Object.prototype.hasOwnProperty.call(source, key) : void 0 !== existing;
        if (isOpaqueDescriptor(descriptor, existing)) throw new Error('Carburetor: "' + joinPath(this.basePath, key) + '" cannot take a non-plain-data descriptor — state properties are writable, configurable, enumerable data, no accessors. Derive a computed value instead, e.g. with Computed.');
        const previous = Reflect.get(source, key);
        const raw = 'value' in descriptor ? unwrapWriteProxy(descriptor.value) : wasOwn ? previous : void 0;
        const path = this.writtenPath(key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkKey(source, key, path);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.checkState(raw, path, wasOwn ? previous : void 0);
        null == (_this_aliases2 = this.aliases) || _this_aliases2.checkWrite(source, this.basePath);
        const effective = 'value' in descriptor ? {
            ...descriptor,
            value: raw
        } : descriptor;
        const previousLength = this.isArray ? source.length : void 0;
        const wrote = Reflect.defineProperty(source, key, effective);
        if (!wrote) return false;
        if (wasOwn && Object.is(previous, raw)) return true;
        null == (_this_aliases3 = this.aliases) || _this_aliases3.forget(previous);
        if (!wasOwn) this.record(this.keysMarker());
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) this.reportPatch(listener, key, wasOwn ? previous : PATCH_ABSENT, raw);
        this.record(path);
        if (void 0 !== previousLength && source.length !== previousLength) {
            const nextLength = source.length;
            if (listener) this.reportPatch(listener, 'length', previousLength, nextLength);
            this.record(this.writtenPath('length'));
        }
        return true;
    }
    deleteProperty(source, key) {
        var _this_aliases, _this_aliases1, _this_patchPort;
        if (!Object.prototype.hasOwnProperty.call(source, key)) return true;
        if ('symbol' == typeof key) return forbidSymbolKey(this.basePath);
        const previous = Reflect.get(source, key);
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        if (!Reflect.deleteProperty(source, key)) return false;
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        this.record(this.keysMarker());
        const path = this.writtenPath(key);
        const listener = null == (_this_patchPort = this.patchPort) ? void 0 : _this_patchPort.listener;
        if (listener) this.reportPatch(listener, key, previous, PATCH_ABSENT);
        this.record(path);
        return true;
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
