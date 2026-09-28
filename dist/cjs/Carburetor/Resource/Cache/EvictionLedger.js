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
class EvictionLedger {
    lastUsed = new Map();
    count = 0;
    walks = 0;
    useTick = 0;
    retainedAtCount = void 0;
    touch(key) {
        this.useTick += 1;
        this.lastUsed.delete(key);
        this.lastUsed.set(key, this.useTick);
    }
    create() {
        this.count += 1;
    }
    forget(key) {
        this.count -= 1;
        this.lastUsed.delete(key);
    }
    reset() {
        this.lastUsed.clear();
        this.count = 0;
        this.retainedAtCount = void 0;
    }
    setCount(count) {
        this.count = count;
    }
    release() {
        this.retainedAtCount = void 0;
    }
    shouldSkip(maxEntries) {
        if (this.count <= maxEntries) return true;
        if (void 0 === this.retainedAtCount) return false;
        const growthNeeded = Math.max(maxEntries, this.retainedAtCount);
        return this.count < this.retainedAtCount + growthNeeded;
    }
    selectVictims(maxEntries, isRetained) {
        const excess = this.count - maxEntries;
        const doomed = [];
        for (const key of this.lastUsed.keys()){
            if (doomed.length >= excess) break;
            this.walks += 1;
            if (!isRetained(key)) doomed.push(key);
        }
        this.retainedAtCount = doomed.length < excess ? this.count : void 0;
        this.count -= doomed.length;
        doomed.forEach((key)=>this.lastUsed.delete(key));
        return doomed;
    }
}
__webpack_require__.d(__webpack_exports__, {
    EvictionLedger: ()=>EvictionLedger
});
exports.EvictionLedger = __webpack_exports__.EvictionLedger;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "EvictionLedger"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
