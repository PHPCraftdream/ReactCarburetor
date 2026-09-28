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
    SubscriberIndex: ()=>SubscriberIndex
});
const external_PathSeparator_js_namespaceObject = require("./PathSeparator.js");
const external_WildcardPath_js_namespaceObject = require("./WildcardPath.js");
class SubscriberIndex {
    exact = new Map();
    branch = new Map();
    wildcard = new Set();
    readsById = new Map();
    filedById = new Map();
    add(id, reads) {
        const filed = this.filedById.get(id);
        this.readsById.set(id, reads);
        if (!filed) return void this.registerFresh(id, reads);
        const stale = [];
        filed.forEach((path)=>{
            if (!reads.has(path)) stale.push(path);
        });
        stale.forEach((path)=>{
            this.unfile(id, path);
            filed.delete(path);
        });
        reads.forEach((path)=>{
            if (path === external_WildcardPath_js_namespaceObject.WILDCARD_PATH || filed.has(path)) return;
            this.file(id, path);
            filed.add(path);
        });
        const wantsWildcard = reads.has(external_WildcardPath_js_namespaceObject.WILDCARD_PATH);
        if (wantsWildcard) this.wildcard.add(id);
        else this.wildcard.delete(id);
    }
    addPath(id, path) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        reads.add(path);
        if (path === external_WildcardPath_js_namespaceObject.WILDCARD_PATH) return void this.wildcard.add(id);
        const filed = this.filedById.get(id);
        if (filed.has(path)) return;
        this.file(id, path);
        filed.add(path);
    }
    remove(id) {
        const filed = this.filedById.get(id);
        if (!filed) return;
        this.readsById.delete(id);
        this.filedById.delete(id);
        this.wildcard.delete(id);
        filed.forEach((path)=>this.unfile(id, path));
    }
    match(writes) {
        if (writes.has(external_WildcardPath_js_namespaceObject.WILDCARD_PATH)) return new Set(this.readsById.keys());
        const matched = this.wildcard.size > 0 ? new Set(this.wildcard) : new Set();
        writes.forEach((writePath)=>{
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            this.ancestorsOf(writePath).forEach((ancestor)=>this.collect(this.exact.get(ancestor), matched));
        });
        return matched;
    }
    hasReaderAt(path) {
        return this.exact.has(path) || this.branch.has(path);
    }
    registerFresh(id, reads) {
        const filed = new Set();
        this.filedById.set(id, filed);
        reads.forEach((path)=>{
            if (path === external_WildcardPath_js_namespaceObject.WILDCARD_PATH) return void this.wildcard.add(id);
            this.file(id, path);
            filed.add(path);
        });
    }
    file(id, path) {
        this.register(this.exact, path, id);
        this.ancestorsOf(path).forEach((ancestor)=>this.register(this.branch, ancestor, id));
    }
    unfile(id, path) {
        this.unregister(this.exact, path, id);
        this.ancestorsOf(path).forEach((ancestor)=>this.unregister(this.branch, ancestor, id));
    }
    ancestorsOf(path) {
        const chain = [];
        let cut = path.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR);
        while(cut > 0){
            const ancestor = path.slice(0, cut);
            chain.push(ancestor);
            cut = ancestor.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR);
        }
        return chain;
    }
    register(target, path, id) {
        const known = target.get(path);
        if (void 0 === known) return void target.set(path, id);
        if ('string' == typeof known) {
            if (known === id) return;
            target.set(path, new Set([
                known,
                id
            ]));
            return;
        }
        known.add(id);
    }
    unregister(target, path, id) {
        const known = target.get(path);
        if (void 0 === known) return;
        if ('string' == typeof known) {
            if (known === id) target.delete(path);
            return;
        }
        known.delete(id);
        if (1 === known.size) {
            const [remaining] = known;
            target.set(path, remaining);
        }
    }
    collect(source, target) {
        if (void 0 === source) return;
        if ('string' == typeof source) return void target.add(source);
        source.forEach((id)=>target.add(id));
    }
}
exports.SubscriberIndex = __webpack_exports__.SubscriberIndex;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "SubscriberIndex"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
