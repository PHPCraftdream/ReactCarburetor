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
    applyDiff: ()=>applyDiff
});
const isTrackable_js_namespaceObject = require("../../Tracking/isTrackable.js");
const deepClone_js_namespaceObject = require("../../Utils/deepClone.js");
const external_DiffThreshold_js_namespaceObject = require("./DiffThreshold.js");
const external_hasSymbolDifference_js_namespaceObject = require("./hasSymbolDifference.js");
const external_sameKind_js_namespaceObject = require("./sameKind.js");
class ApplyDiffOverflow extends Error {
}
const spend = (budget)=>{
    budget.spent++;
    if (budget.spent > external_DiffThreshold_js_namespaceObject.DIFF_PATH_THRESHOLD) throw new ApplyDiffOverflow();
};
const applyDiff_assign = (target, key, value)=>{
    if ('__proto__' === key) return void Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    });
    target[key] = value;
};
const applyKey = (target, key, previous, next, budget)=>{
    if (Object.is(previous, next)) return;
    if ((0, isTrackable_js_namespaceObject.isTrackable)(previous) && (0, isTrackable_js_namespaceObject.isTrackable)(next) && (0, external_sameKind_js_namespaceObject.sameKind)(previous, next) && !(0, external_hasSymbolDifference_js_namespaceObject.hasSymbolDifference)(previous, next)) return void applyBranch(target[key], previous, next, budget);
    spend(budget);
    applyDiff_assign(target, key, (0, deepClone_js_namespaceObject.deepClone)(next));
};
const applyBranch = (target, previous, next, budget)=>{
    const previousLength = previous.length;
    const nextLength = next.length;
    if (Array.isArray(previous) && nextLength < previousLength) {
        spend(budget);
        target.length = nextLength;
    }
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    const seen = new Set();
    for (const key of previousKeys){
        seen.add(key);
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            spend(budget);
            delete target[key];
            continue;
        }
        applyKey(target, key, previous[key], next[key], budget);
    }
    for (const key of nextKeys)if (!seen.has(key)) {
        spend(budget);
        applyDiff_assign(target, key, (0, deepClone_js_namespaceObject.deepClone)(next[key]));
    }
};
const applyDiff = (target, previous, next)=>{
    try {
        applyBranch(target, previous, next, {
            spent: 0
        });
    } catch (error) {
        if (error instanceof ApplyDiffOverflow) return false;
        throw error;
    }
    return true;
};
exports.applyDiff = __webpack_exports__.applyDiff;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "applyDiff"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
