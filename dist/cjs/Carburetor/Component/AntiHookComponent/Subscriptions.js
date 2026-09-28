"use strict";
"use client";
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
    AntiHookComponentSubscriptions: ()=>AntiHookComponentSubscriptions
});
const external_Effects_js_namespaceObject = require("./Effects.js");
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
class AntiHookComponentSubscriptions extends external_Effects_js_namespaceObject.AntiHookComponentEffects {
    onCarburetorUpdate = ()=>{
        this.forceUpdate();
    };
    commitSubscriptions() {
        const attempt = this.pendingAttempt;
        const fresh = void 0 !== attempt && !attempt.abandoned && attempt !== this.committedAttempt;
        if (fresh) {
            this.committedAttempt = attempt;
            const trackedEntries = attempt.tracked;
            const connectionEntries = attempt.connections;
            this.tracked.forEach((slot, source)=>{
                if (void 0 !== trackedEntries && trackedEntries.has(source)) return;
                this.releaseSlot(this.uid, slot);
                this.tracked.delete(source);
            });
            this.connections.forEach((connection)=>{
                if (void 0 === connectionEntries || !connectionEntries.has(connection)) connection.committed = void 0;
            });
            if (void 0 !== trackedEntries) trackedEntries.forEach((entry, source)=>{
                const description = {
                    carburetor: entry.source,
                    baselineVersion: entry.baselineVersion,
                    reads: entry.reads
                };
                const known = this.tracked.get(source);
                this.tracked.set(source, {
                    committed: description,
                    installed: known ? known.installed : void 0
                });
            });
            if (void 0 !== connectionEntries) connectionEntries.forEach((entry, connection)=>{
                connection.committed = {
                    carburetor: entry.source,
                    baselineVersion: entry.baselineVersion,
                    reads: entry.reads
                };
            });
        }
        let changedDuringRender = false;
        this.tracked.forEach((slot)=>{
            if (this.alignSubscription(this.uid, slot)) changedDuringRender = true;
        });
        this.connections.forEach((connection)=>{
            if (this.alignSubscription(connection.uid, connection)) changedDuringRender = true;
        });
        if (changedDuringRender) this.forceUpdate();
    }
    alignSubscription(uid, slot) {
        const committed = slot.committed;
        const installed = slot.installed;
        if (!committed) {
            if (installed) {
                installed.carburetor.unsubscribe(uid);
                slot.installed = void 0;
            }
            return false;
        }
        if (installed && installed.carburetor !== committed.carburetor) {
            installed.carburetor.unsubscribe(uid);
            slot.installed = void 0;
        }
        if (void 0 === slot.installed || !sameReads(slot.installed.reads, committed.reads)) {
            committed.carburetor.subscribe(this.onCarburetorUpdate, {
                id: uid,
                reads: committed.reads
            });
            slot.installed = {
                carburetor: committed.carburetor,
                reads: committed.reads
            };
        }
        return committed.carburetor.getVersion() !== committed.baselineVersion;
    }
    releaseSlot(uid, slot) {
        if (slot.installed) {
            slot.installed.carburetor.unsubscribe(uid);
            slot.installed = void 0;
        }
    }
    releaseSubscriptions() {
        this.tracked.forEach((slot)=>{
            this.releaseSlot(this.uid, slot);
        });
        this.connections.forEach((connection)=>{
            this.releaseSlot(connection.uid, connection);
        });
        this.renderAttempt = void 0;
    }
}
exports.AntiHookComponentSubscriptions = __webpack_exports__.AntiHookComponentSubscriptions;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponentSubscriptions"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
