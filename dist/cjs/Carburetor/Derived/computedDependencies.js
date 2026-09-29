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
    computedDependencies: ()=>computedDependencies
});
const getUid_js_namespaceObject = require("../Store/Utils/getUid.js");
const sharedSingleton_js_namespaceObject = require("../Store/Utils/sharedSingleton.js");
const UpdateWaveInstance_js_namespaceObject = require("../Store/Scheduling/UpdateWaveInstance.js");
const versions = (0, sharedSingleton_js_namespaceObject.sharedSingleton)('computedVersions', ()=>new WeakMap());
const bridges = (0, sharedSingleton_js_namespaceObject.sharedSingleton)('computedExternalBridges', ()=>new WeakMap());
const computedDependencies = {
    versions,
    subscribe (source, callback, options) {
        if ('read' in source || versions.has(source)) return void source.subscribe(callback, options);
        const existing = bridges.get(source);
        if (existing) return void existing.subscribers.set(options.id, callback);
        const bridge = {
            id: (0, getUid_js_namespaceObject.getUid)(),
            subscribers: new Map([
                [
                    options.id,
                    callback
                ]
            ])
        };
        bridges.set(source, bridge);
        try {
            source.subscribe(()=>{
                UpdateWaveInstance_js_namespaceObject.updateWave.begin();
                try {
                    for (const id of Array.from(bridge.subscribers.keys())){
                        var _bridge_subscribers_get;
                        null == (_bridge_subscribers_get = bridge.subscribers.get(id)) || _bridge_subscribers_get();
                    }
                } finally{
                    UpdateWaveInstance_js_namespaceObject.updateWave.end();
                }
            }, {
                id: bridge.id
            });
        } catch (error) {
            bridges.delete(source);
            try {
                source.unsubscribe(bridge.id);
            } catch  {}
            throw error;
        }
    },
    unsubscribe (source, id) {
        if ('read' in source || versions.has(source)) return void source.unsubscribe(id);
        const bridge = bridges.get(source);
        if (!bridge) return;
        bridge.subscribers.delete(id);
        if (0 === bridge.subscribers.size) {
            bridges.delete(source);
            source.unsubscribe(bridge.id);
        }
    }
};
exports.computedDependencies = __webpack_exports__.computedDependencies;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "computedDependencies"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
