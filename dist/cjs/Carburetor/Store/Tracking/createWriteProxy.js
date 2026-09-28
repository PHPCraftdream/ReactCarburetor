"use strict";
var __webpack_require__ = {};
(()=>{
    __webpack_require__.d = (exports1, getters, values)=>{
        var define = (defs, kind)=>{
            for(var key in defs)if (__webpack_require__.o(defs, key) && !__webpack_require__.o(exports1, key)) Object.defineProperty(exports1, key, {
                enumerable: true,
                [kind]: defs[key]
            });
        };
        define(getters, "get");
        define(values, "value");
    };
})();
(()=>{
    __webpack_require__.o = (obj, prop)=>Object.prototype.hasOwnProperty.call(obj, prop);
})();
(()=>{
    __webpack_require__.r = (exports1)=>{
        if ("u" > typeof Symbol && Symbol.toStringTag) Object.defineProperty(exports1, Symbol.toStringTag, {
            value: 'Module'
        });
        Object.defineProperty(exports1, '__esModule', {
            value: true
        });
    };
})();
var __webpack_exports__ = {};
__webpack_require__.r(__webpack_exports__);
__webpack_require__.d(__webpack_exports__, {
    createWriteProxy: ()=>createWriteProxy
});
const joinPath_js_namespaceObject = require("../Paths/joinPath.js");
const WildcardPath_js_namespaceObject = require("../Paths/WildcardPath.js");
const external_createProxyCache_js_namespaceObject = require("./createProxyCache.js");
const external_Models_js_namespaceObject = require("./Models.js");
const external_isTrackable_js_namespaceObject = require("./isTrackable.js");
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
    writtenPath(key) {
        if ('symbol' == typeof key || this.basePath === WildcardPath_js_namespaceObject.WILDCARD_PATH) return WildcardPath_js_namespaceObject.WILDCARD_PATH;
        return (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key);
    }
    get(source, key) {
        if (key === external_Models_js_namespaceObject.PROXY_CACHE) return this.cache;
        const value = Reflect.get(source, key);
        if ('function' == typeof value) return value;
        const path = 'symbol' == typeof key || this.basePath === WildcardPath_js_namespaceObject.WILDCARD_PATH ? WildcardPath_js_namespaceObject.WILDCARD_PATH : (0, joinPath_js_namespaceObject.joinPath)(this.basePath, key);
        if ((0, external_isTrackable_js_namespaceObject.isTrackable)(value)) return this.cache(path, value, ()=>createWriteProxy(value, this.record, path, this.aliases, this.cache));
        if (null !== value && 'object' == typeof value) this.record(path);
        return value;
    }
    set(source, key, value) {
        var _this_aliases, _this_aliases1;
        const previous = Reflect.get(source, key);
        const raw = unwrapWriteProxy(value);
        if (Object.prototype.hasOwnProperty.call(source, key) && Object.is(previous, raw)) return true;
        null == (_this_aliases = this.aliases) || _this_aliases.checkWrite(source, this.basePath);
        null == (_this_aliases1 = this.aliases) || _this_aliases1.forget(previous);
        if (this.isArray && 'length' === key && 'number' == typeof raw && 'number' == typeof previous && raw < previous) for(let removed = raw; removed < previous; removed++)this.record((0, joinPath_js_namespaceObject.joinPath)(this.basePath, String(removed)));
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
    const cached = cache ?? (0, external_createProxyCache_js_namespaceObject.createProxyCache)();
    const handler = new WriteProxyHandler(basePath, record, aliases, cached, Array.isArray(target));
    const proxy = new Proxy(target, handler);
    proxyTargets.set(proxy, target);
    return proxy;
};
exports.createWriteProxy = __webpack_exports__.createWriteProxy;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createWriteProxy"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
