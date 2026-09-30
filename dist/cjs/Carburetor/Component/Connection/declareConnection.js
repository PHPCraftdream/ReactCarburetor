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
class ConnectionSource {
    getAttempt;
    connection;
    getCarburetor;
    recorder;
    arrayFacade = false;
    probeError = void 0;
    cachedTarget = void 0;
    cachedView = void 0;
    constructor(getAttempt, source){
        this.getAttempt = getAttempt;
        this.getCarburetor = 'function' == typeof source ? source : ()=>source;
        this.connection = {
            uid: (0, getUid_js_namespaceObject.getUid)(),
            getCarburetor: this.getCarburetor,
            committed: void 0,
            installed: void 0,
            attemptTag: void 0,
            attemptSource: void 0,
            attemptEntry: void 0
        };
        this.recorder = this.recordPath.bind(this);
    }
    tagAttempt(attempt) {
        const connection = this.connection;
        if (connection.attemptTag !== attempt) {
            connection.attemptTag = attempt;
            connection.attemptSource = void 0;
            connection.attemptEntry = void 0;
        }
    }
    resolveAttemptSource() {
        const attempt = this.getAttempt();
        if (!attempt) return this.getCarburetor();
        this.tagAttempt(attempt);
        const connection = this.connection;
        if (void 0 !== connection.attemptSource) return connection.attemptSource;
        const carburetor = this.getCarburetor();
        connection.attemptSource = carburetor;
        return carburetor;
    }
    recordPath(path) {
        const attempt = this.getAttempt();
        if (!attempt) return;
        this.tagAttempt(attempt);
        const connection = this.connection;
        let entry = connection.attemptEntry;
        if (!entry) {
            const carburetor = this.resolveAttemptSource();
            entry = {
                source: carburetor,
                baselineVersion: carburetor.getVersion(),
                reads: new Set()
            };
            connection.attemptEntry = entry;
            if (void 0 === attempt.connections) attempt.connections = [];
            attempt.connections.push(connection);
        }
        entry.reads.add(path);
    }
}
const declareConnection = (connections, getAttempt, source)=>{
    const state = new ConnectionSource(getAttempt, source);
    connections.push(state.connection);
    return state;
};
exports.declareConnection = __webpack_exports__.declareConnection;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "declareConnection"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
