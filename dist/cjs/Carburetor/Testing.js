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
    waitForUpdate: ()=>waitForUpdate
});
const external_Paths_js_namespaceObject = require("./Paths.js");
const waitForUpdate = (source, timeout = 1000)=>new Promise((resolve, reject)=>{
        const id = source.subscribe(()=>{
            clearTimeout(timer);
            source.unsubscribe(id);
            resolve();
        }, void 0, new Set([
            external_Paths_js_namespaceObject.WILDCARD_PATH
        ]));
        const timer = setTimeout(()=>{
            source.unsubscribe(id);
            reject(new Error('waitForUpdate: no update within ' + timeout + 'ms'));
        }, timeout);
    });
exports.waitForUpdate = __webpack_exports__.waitForUpdate;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "waitForUpdate"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
