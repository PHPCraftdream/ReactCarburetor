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
    Carburetor: ()=>Carburetor
});
const external_Paths_js_namespaceObject = require("./Paths.js");
const external_SyncUpdateScheduler_js_namespaceObject = require("./SyncUpdateScheduler.js");
const external_Tracking_js_namespaceObject = require("./Tracking.js");
const getUid_js_namespaceObject = require("./Utils/getUid.js");
class Carburetor {
    data;
    scheduler;
    subscribers = {};
    uid = (0, getUid_js_namespaceObject.getUid)();
    version = 0;
    writes = new Set();
    draftTouched = false;
    draftProxy = void 0;
    constructor(data, scheduler = external_SyncUpdateScheduler_js_namespaceObject.syncUpdateScheduler){
        this.data = data;
        this.scheduler = scheduler;
    }
    getUID = ()=>this.uid;
    getVersion = ()=>this.version;
    getData = ()=>this.data;
    read = (record)=>{
        const data = this.data;
        if (!(0, external_Tracking_js_namespaceObject.isTrackable)(data)) {
            record(external_Paths_js_namespaceObject.WILDCARD_PATH);
            return this.data;
        }
        return (0, external_Tracking_js_namespaceObject.createReadProxy)(data, record);
    };
    setData = (data)=>{
        this.data = data;
        this.draftProxy = void 0;
        this.writes.add(external_Paths_js_namespaceObject.WILDCARD_PATH);
        this.emitUpdate();
        return data;
    };
    subscribe = (callback, customId, reads)=>{
        const id = customId || (0, getUid_js_namespaceObject.getUid)();
        this.subscribers[id] = {
            callback,
            reads: reads || new Set([
                external_Paths_js_namespaceObject.WILDCARD_PATH
            ])
        };
        return id;
    };
    unsubscribe = (id)=>{
        if (id in this.subscribers) {
            this.scheduler.cancel(id);
            delete this.subscribers[id];
        }
    };
    get draft() {
        const data = this.data;
        this.draftTouched = true;
        if (!(0, external_Tracking_js_namespaceObject.isTrackable)(data)) return this.data;
        if (!this.draftProxy) this.draftProxy = (0, external_Tracking_js_namespaceObject.createWriteProxy)(data, this.recordWrite);
        return this.draftProxy;
    }
    recordWrite = (path)=>{
        this.writes.add(path);
    };
    preEmit = ()=>{};
    emitUpdate = ()=>{
        this.preEmit();
        const changed = this.writes.size > 0 ? new Set(this.writes) : void 0;
        const touched = this.draftTouched;
        this.writes.clear();
        this.draftTouched = false;
        if (!changed && touched) return;
        const writes = changed || new Set([
            external_Paths_js_namespaceObject.WILDCARD_PATH
        ]);
        this.version++;
        Object.keys(this.subscribers).forEach((id)=>{
            const record = this.subscribers[id];
            if ((0, external_Paths_js_namespaceObject.pathsIntersect)(record.reads, writes)) this.scheduler.schedule(id, record.callback);
        });
    };
}
exports.Carburetor = __webpack_exports__.Carburetor;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "Carburetor"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
