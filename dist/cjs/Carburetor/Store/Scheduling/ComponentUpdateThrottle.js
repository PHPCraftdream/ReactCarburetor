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
class ComponentUpdateThrottle {
    updateTimeout;
    maxUpdateDepth = 50;
    timeout = void 0;
    updaters = new Map();
    constructor(updateTimeout = 40){
        this.updateTimeout = updateTimeout;
    }
    schedule = (uid, updater)=>{
        this.updaters.set(uid, updater);
        this.setupTimeout();
    };
    cancel = (uid)=>{
        this.updaters.delete(uid);
    };
    setupTimeout = ()=>{
        if (!this.timeout) this.timeout = setTimeout(this.letsUpdate, this.updateTimeout);
    };
    clearTimeout = ()=>{
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = void 0;
    };
    runUpdater = (updater)=>{
        updater();
    };
    letsUpdate = ()=>{
        let depth = 0;
        while(this.updaters.size > 0){
            if (depth++ >= this.maxUpdateDepth) {
                this.updaters.clear();
                this.clearTimeout();
                throw new Error('ComponentUpdateThrottle: exceeded max update depth of ' + this.maxUpdateDepth + '. An updater keeps scheduling new updates — this is an infinite update loop.');
            }
            const batch = Array.from(this.updaters.values());
            this.updaters.clear();
            batch.forEach(this.runUpdater);
        }
        this.clearTimeout();
    };
}
__webpack_require__.d(__webpack_exports__, {
    ComponentUpdateThrottle: ()=>ComponentUpdateThrottle
});
exports.ComponentUpdateThrottle = __webpack_exports__.ComponentUpdateThrottle;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "ComponentUpdateThrottle"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
