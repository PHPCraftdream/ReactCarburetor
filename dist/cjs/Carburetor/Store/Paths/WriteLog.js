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
    WriteLog: ()=>WriteLog
});
const external_PathSeparator_js_namespaceObject = require("./PathSeparator.js");
const external_WildcardPath_js_namespaceObject = require("./WildcardPath.js");
const DEFAULT_CAPACITY = 8192;
class WriteLog {
    capacity;
    last = new Map();
    under = new Map();
    wildcardVersion = 0;
    watermark = 0;
    constructor(capacity = DEFAULT_CAPACITY){
        this.capacity = capacity;
    }
    record(version, writes) {
        for (const path of writes){
            if (path === external_WildcardPath_js_namespaceObject.WILDCARD_PATH) {
                this.wildcardVersion = version;
                continue;
            }
            this.last.set(path, version);
            let cut = path.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR);
            while(cut > 0){
                this.under.set(path.slice(0, cut), version);
                cut = path.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR, cut - 1);
            }
        }
        if (this.last.size + this.under.size > this.capacity) {
            this.last.clear();
            this.under.clear();
            this.watermark = version;
        }
    }
    matches(baselineVersion, reads) {
        if (baselineVersion < this.watermark || this.wildcardVersion > baselineVersion) return true;
        if (reads.has(external_WildcardPath_js_namespaceObject.WILDCARD_PATH)) return true;
        for (const path of reads){
            if ((this.last.get(path) ?? 0) > baselineVersion || (this.under.get(path) ?? 0) > baselineVersion) return true;
            let cut = path.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR);
            while(cut > 0){
                if ((this.last.get(path.slice(0, cut)) ?? 0) > baselineVersion) return true;
                cut = path.lastIndexOf(external_PathSeparator_js_namespaceObject.PATH_SEPARATOR, cut - 1);
            }
        }
        return false;
    }
}
exports.WriteLog = __webpack_exports__.WriteLog;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "WriteLog"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
