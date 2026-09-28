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
    ancestorsById = new Map();
    add(id, reads) {
        this.remove(id);
        this.readsById.set(id, reads);
        const ancestors = new Map();
        this.ancestorsById.set(id, ancestors);
        reads.forEach((readPath)=>{
            if (readPath === external_WildcardPath_js_namespaceObject.WILDCARD_PATH) return void this.wildcard.add(id);
            this.file(id, readPath, ancestors);
        });
    }
    addPath(id, path) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        reads.add(path);
        if (path === external_WildcardPath_js_namespaceObject.WILDCARD_PATH) return void this.wildcard.add(id);
        const exactReaders = this.exact.get(path);
        if (exactReaders && exactReaders.has(id)) return;
        let ancestors = this.ancestorsById.get(id);
        if (!ancestors) {
            ancestors = new Map();
            this.ancestorsById.set(id, ancestors);
        }
        this.file(id, path, ancestors);
    }
    remove(id) {
        const reads = this.readsById.get(id);
        if (!reads) return;
        const ancestors = this.ancestorsById.get(id);
        this.readsById.delete(id);
        this.ancestorsById.delete(id);
        this.wildcard.delete(id);
        reads.forEach((readPath)=>{
            this.unregister(this.exact, readPath, id);
            const chain = (null == ancestors ? void 0 : ancestors.get(readPath)) || this.ancestorsOf(readPath);
            chain.forEach((ancestor)=>this.unregister(this.branch, ancestor, id));
        });
    }
    match(writes) {
        if (writes.has(external_WildcardPath_js_namespaceObject.WILDCARD_PATH)) return new Set(this.readsById.keys());
        const matched = new Set(this.wildcard);
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
    file(id, path, ancestors) {
        this.register(this.exact, path, id);
        const chain = this.ancestorsOf(path);
        ancestors.set(path, chain);
        chain.forEach((ancestor)=>this.register(this.branch, ancestor, id));
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
        if (known) return void known.add(id);
        target.set(path, new Set([
            id
        ]));
    }
    unregister(target, path, id) {
        const known = target.get(path);
        if (!known) return;
        known.delete(id);
        if (0 === known.size) target.delete(path);
    }
    collect(source, target) {
        if (!source) return;
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
