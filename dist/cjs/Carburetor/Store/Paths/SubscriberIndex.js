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
    add = (id, reads)=>{
        this.remove(id);
        this.readsById.set(id, reads);
        reads.forEach((readPath)=>{
            if (readPath === external_WildcardPath_js_namespaceObject.WILDCARD_PATH) return void this.wildcard.add(id);
            this.register(this.exact, readPath, id);
            this.eachAncestor(readPath, (ancestor)=>this.register(this.branch, ancestor, id));
        });
    };
    remove = (id)=>{
        const reads = this.readsById.get(id);
        if (!reads) return;
        this.readsById.delete(id);
        this.wildcard.delete(id);
        reads.forEach((readPath)=>{
            this.unregister(this.exact, readPath, id);
            this.eachAncestor(readPath, (ancestor)=>this.unregister(this.branch, ancestor, id));
        });
    };
    match = (writes)=>{
        if (writes.has(external_WildcardPath_js_namespaceObject.WILDCARD_PATH)) return new Set(this.readsById.keys());
        const matched = new Set(this.wildcard);
        writes.forEach((writePath)=>{
            this.collect(this.exact.get(writePath), matched);
            this.collect(this.branch.get(writePath), matched);
            this.eachAncestor(writePath, (ancestor)=>this.collect(this.exact.get(ancestor), matched));
        });
        return matched;
    };
    eachAncestor = (path, visit)=>{
        let cut = path.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR);
        while(cut > 0){
            const ancestor = path.slice(0, cut);
            visit(ancestor);
            cut = ancestor.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR);
        }
    };
    register = (target, path, id)=>{
        const known = target.get(path);
        if (known) return void known.add(id);
        target.set(path, new Set([
            id
        ]));
    };
    unregister = (target, path, id)=>{
        const known = target.get(path);
        if (!known) return;
        known.delete(id);
        if (0 === known.size) target.delete(path);
    };
    collect = (source, target)=>{
        if (!source) return;
        source.forEach((id)=>target.add(id));
    };
}
exports.SubscriberIndex = __webpack_exports__.SubscriberIndex;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "SubscriberIndex"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
