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
    CarburetorHistory: ()=>CarburetorHistory
});
const external_Paths_js_namespaceObject = require("./Paths.js");
class CarburetorHistory {
    carburetor;
    past = [];
    future = [];
    current;
    limit;
    applying = false;
    dispose;
    constructor(carburetor, options = {}){
        this.carburetor = carburetor;
        this.limit = options.limit || 50;
        this.current = carburetor.snapshot();
        this.dispose = carburetor.watch(new Set([
            external_Paths_js_namespaceObject.WILDCARD_PATH
        ]), this.record);
    }
    canUndo = ()=>this.past.length > 0;
    canRedo = ()=>this.future.length > 0;
    undo = ()=>{
        const previous = this.past.pop();
        if (void 0 === previous) return false;
        this.future.push(this.current);
        this.apply(previous);
        return true;
    };
    redo = ()=>{
        const next = this.future.pop();
        if (void 0 === next) return false;
        this.past.push(this.current);
        this.apply(next);
        return true;
    };
    clear = ()=>{
        this.past = [];
        this.future = [];
    };
    disconnect = ()=>{
        this.dispose();
    };
    record = ()=>{
        if (this.applying) return;
        this.past.push(this.current);
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
        this.current = this.carburetor.snapshot();
    };
    apply = (state)=>{
        this.applying = true;
        try {
            this.carburetor.restore(state);
            this.current = this.carburetor.snapshot();
        } finally{
            this.applying = false;
        }
    };
}
exports.CarburetorHistory = __webpack_exports__.CarburetorHistory;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "CarburetorHistory"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
