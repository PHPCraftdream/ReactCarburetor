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
const declareConnection = (connections, attemptKeyPrefix, getAttempt, source)=>{
    const getCarburetor = 'function' == typeof source ? source : ()=>source;
    const connection = {
        uid: (0, getUid_js_namespaceObject.getUid)(),
        getCarburetor,
        committed: void 0,
        installed: void 0
    };
    connections.push(connection);
    const resolveAttemptSource = ()=>{
        const attempt = getAttempt();
        if (!attempt) return getCarburetor();
        const key = attemptKeyPrefix + connection.uid;
        const resolved = attempt.sources.get(key);
        if (void 0 !== resolved) return resolved;
        const carburetor = getCarburetor();
        attempt.sources.set(key, carburetor);
        return carburetor;
    };
    const recorder = (path)=>{
        const attempt = getAttempt();
        if (!attempt) return;
        let entry = attempt.entries.get(attemptKeyPrefix + connection.uid);
        if (!entry) {
            const carburetor = resolveAttemptSource();
            entry = {
                connection,
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set()
            };
            attempt.entries.set(attemptKeyPrefix + connection.uid, entry);
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
