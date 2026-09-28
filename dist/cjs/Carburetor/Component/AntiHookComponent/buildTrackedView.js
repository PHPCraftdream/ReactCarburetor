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
    buildTrackedView: ()=>buildTrackedView
});
const isTrackable_js_namespaceObject = require("../../Store/Tracking/isTrackable.js");
const buildTrackedView = (views, carburetor, getRenderAttempt, attempt, entry)=>{
    const data = carburetor.getData();
    if (!(0, isTrackable_js_namespaceObject.isTrackable)(data)) return carburetor.read((path)=>{
        if (void 0 !== attempt) entry.reads.add(path);
    });
    const cached = views.get(carburetor);
    if (void 0 !== cached && cached.data === data) {
        cached.attempt = attempt;
        cached.entry = entry;
        return cached.view;
    }
    const tracked = {
        data,
        view: void 0,
        attempt,
        entry
    };
    tracked.view = carburetor.read((path)=>{
        if (void 0 !== tracked.attempt && getRenderAttempt() === tracked.attempt) tracked.entry.reads.add(path);
    });
    views.set(carburetor, tracked);
    return tracked.view;
};
exports.buildTrackedView = __webpack_exports__.buildTrackedView;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "buildTrackedView"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
