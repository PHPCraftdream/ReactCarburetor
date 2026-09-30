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
    liveViews: ()=>liveViews
});
const sharedSingleton_js_namespaceObject = require("../Utils/sharedSingleton.js");
const knownViews = (0, sharedSingleton_js_namespaceObject.sharedSingleton)('liveViews', ()=>new WeakMap());
const liveViews = {
    note: (view)=>{
        if (!knownViews.has(view)) knownViews.set(view, void 0);
    },
    noteReadTarget: (view, target)=>{
        knownViews.set(view, target);
    },
    noteDynamicReadTarget: (view, resolve)=>{
        knownViews.set(view, resolve);
    },
    readTarget: (view)=>{
        const known = knownViews.get(view);
        return 'function' == typeof known ? known() : known;
    },
    has: (value)=>'object' == typeof value && null !== value && knownViews.has(value)
};
exports.liveViews = __webpack_exports__.liveViews;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "liveViews"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
