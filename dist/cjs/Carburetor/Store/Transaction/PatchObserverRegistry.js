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
    PatchObserverRegistry: ()=>PatchObserverRegistry
});
const getUid_js_namespaceObject = require("../Utils/getUid.js");
class PatchObserverRegistry {
    port;
    scheduler;
    registrations = new Map();
    generation = 0;
    single;
    patchOnly;
    fanout;
    reportPatch(patch) {
        const generation = this.generation;
        let failed = false;
        let firstError;
        for (const registration of this.registrations.values()){
            const observer = registration.observer;
            if (!(registration.generation > generation) && this.registrations.get(observer) === registration) try {
                observer.patch(patch);
            } catch (error) {
                if (!failed) {
                    firstError = error;
                    failed = true;
                }
            }
        }
        if (failed) throw firstError;
    }
    constructor(port, scheduler){
        this.port = port;
        this.scheduler = scheduler;
    }
    attach(observer) {
        var _this_single;
        if (!observer.publication && !observer.ownRestore && this.patchOnly) this.detach(this.patchOnly);
        const previous = this.registrations.get(observer);
        if (previous) this.detach(previous);
        const registration = {
            observer,
            schedulerKey: observer.publication ? (0, getUid_js_namespaceObject.getUid)() : void 0,
            generation: ++this.generation
        };
        this.registrations.set(observer, registration);
        if (!observer.publication && !observer.ownRestore) this.patchOnly = registration;
        this.single = 1 === this.registrations.size ? registration : void 0;
        if (!this.single) this.fanout ?? (this.fanout = (patch)=>this.reportPatch(patch));
        this.port.listener = (null == (_this_single = this.single) ? void 0 : _this_single.observer.patch) ?? this.fanout;
        return ()=>this.detach(registration);
    }
    detach(registration) {
        var _this_single;
        if (this.registrations.get(registration.observer) !== registration) return;
        if (void 0 !== registration.schedulerKey) this.scheduler.cancel(registration.schedulerKey);
        this.registrations.delete(registration.observer);
        if (this.patchOnly === registration) this.patchOnly = void 0;
        this.single = 1 === this.registrations.size ? this.registrations.values().next().value : void 0;
        this.port.listener = 0 === this.registrations.size ? void 0 : (null == (_this_single = this.single) ? void 0 : _this_single.observer.patch) ?? this.fanout;
    }
    ownRestore(state) {
        const sole = this.single;
        if (sole) {
            var _sole_observer_ownRestore, _sole_observer;
            null == (_sole_observer_ownRestore = (_sole_observer = sole.observer).ownRestore) || _sole_observer_ownRestore.call(_sole_observer, state);
            return;
        }
        if (0 === this.registrations.size) return;
        const generation = this.generation;
        for (const registration of this.registrations.values()){
            const observer = registration.observer;
            if (registration.generation <= generation && this.registrations.get(observer) === registration) {
                var _observer_ownRestore;
                null == (_observer_ownRestore = observer.ownRestore) || _observer_ownRestore.call(observer, state);
            }
        }
    }
    publish() {
        const sole = this.single;
        if (sole) {
            if (sole.observer.publication && void 0 !== sole.schedulerKey) try {
                this.scheduler.schedule(sole.schedulerKey, sole.observer.publication);
            } catch (error) {
                return [
                    error
                ];
            }
            return;
        }
        if (0 === this.registrations.size) return;
        const generation = this.generation;
        let failures;
        for (const registration of this.registrations.values()){
            const observer = registration.observer;
            if (!(registration.generation > generation) && this.registrations.get(observer) === registration) {
                if (observer.publication && void 0 !== registration.schedulerKey) try {
                    this.scheduler.schedule(registration.schedulerKey, observer.publication);
                } catch (error) {
                    (failures ?? (failures = [])).push(error);
                }
            }
        }
        return failures;
    }
}
exports.PatchObserverRegistry = __webpack_exports__.PatchObserverRegistry;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "PatchObserverRegistry"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
