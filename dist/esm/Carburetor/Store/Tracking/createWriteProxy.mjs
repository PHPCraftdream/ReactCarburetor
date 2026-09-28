import { joinPath } from "../Paths/joinPath.mjs";
import { WILDCARD_PATH } from "../Paths/WildcardPath.mjs";
import { createProxyCache } from "./createProxyCache.mjs";
import { PROXY_CACHE } from "./Models.mjs";
import { isTrackable } from "./isTrackable.mjs";
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
    constructor(basePath, record, aliases, cache, isArray){
        this.basePath = basePath;
        this.record = record;
        this.aliases = aliases;
        this.cache = cache;
        this.isArray = isArray;
    }
    childPaths;
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
    wrap(path, source) {
        const cached = this.cache.get(path, source);
        if (void 0 !== cached) return cached;
        const proxy = createWriteProxy(source, this.record, path, this.aliases, this.cache);
        this.cache.set(path, source, proxy);
        return proxy;
    }
    get(source, key) {
        if (key === PROXY_CACHE) return this.cache;
        const value = Reflect.get(source, key);
        if ('function' == typeof value) return value;
        if (isTrackable(value)) return this.wrap(this.writtenPath(key), value);
        if (null !== value && 'object' == typeof value) this.record(this.writtenPath(key));
        return value;
    }
    set(source, key, value) {
        var _this_aliases, _this_aliases1;
        const previous = Reflect.get(source, key);
        const raw = unwrapWriteProxy(value);
        if (Object.prototype.hasOwnProperty.call(source, key) && Object.is(previous, raw)) return true;
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        if (this.isArray && 'length' === key && 'number' == typeof raw && 'number' == typeof previous && raw < previous) for(let removed = raw; removed < previous; removed++)this.record(joinPath(this.basePath, String(removed)));
        const previousLength = this.isArray && 'string' == typeof key && 'length' !== key ? source.length : void 0;
        const path = this.writtenPath(key);
        this.record(path);
        const wrote = Reflect.set(source, key, raw);
        if (void 0 !== previousLength && source.length !== previousLength) this.record(this.writtenPath('length'));
        return wrote;
    }
    defineProperty(source, key, descriptor) {
        var _this_aliases, _this_aliases1;
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(Reflect.get(source, key));
        const path = this.writtenPath(key);
        this.record(path);
        return Reflect.defineProperty(source, key, descriptor);
    }
    deleteProperty(source, key) {
        var _this_aliases, _this_aliases1;
        if (!Reflect.has(source, key)) return true;
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(Reflect.get(source, key));
        const path = this.writtenPath(key);
        this.record(path);
        return Reflect.deleteProperty(source, key);
    }
}
const createWriteProxy = (target, record, basePath = '', aliases, cache)=>{
    const cached = cache ?? createProxyCache();
    const handler = new WriteProxyHandler(basePath, record, aliases, cached, Array.isArray(target));
    const proxy = new Proxy(target, handler);
    proxyTargets.set(proxy, target);
    return proxy;
};
export { createWriteProxy };
