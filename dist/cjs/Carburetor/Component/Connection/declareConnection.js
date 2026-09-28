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
    declareConnection: ()=>declareConnection
});
const getUid_js_namespaceObject = require("../../Store/Utils/getUid.js");
const declareConnection = (connections, getAttempt, source)=>{
    const getCarburetor = 'function' == typeof source ? source : ()=>source;
    const connection = {
        uid: (0, getUid_js_namespaceObject.getUid)(),
        getCarburetor,
        committed: void 0,
        installed: void 0
    };
    connections.push(connection);
    const resolveAttemptSource = ()=>{
        var _attempt_sources;
        const attempt = getAttempt();
        if (!attempt) return getCarburetor();
        const resolved = null == (_attempt_sources = attempt.sources) ? void 0 : _attempt_sources.get(connection);
        if (void 0 !== resolved) return resolved;
        const carburetor = getCarburetor();
        if (void 0 === attempt.sources) attempt.sources = new Map();
        attempt.sources.set(connection, carburetor);
        return carburetor;
    };
    const recorder = (path)=>{
        const attempt = getAttempt();
        if (!attempt) return;
        if (void 0 === attempt.connections) attempt.connections = new Map();
        let entry = attempt.connections.get(connection);
        if (!entry) {
            const carburetor = resolveAttemptSource();
            entry = {
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set()
            };
            attempt.connections.set(connection, entry);
        }
        entry.reads.add(path);
    };
    return {
        connection,
        getCarburetor,
        resolveAttemptSource,
        recorder
    };
};
exports.declareConnection = __webpack_exports__.declareConnection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "declareConnection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
