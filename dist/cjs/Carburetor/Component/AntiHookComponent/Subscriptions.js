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
            const touchedConnections = attempt.connections;
            if (void 0 !== this.tracked) {
                for (const [source, slot] of this.tracked)if (!(void 0 !== trackedEntries && trackedEntries.has(source))) {
                    this.releaseSlot(this.uid, slot);
                    this.tracked.delete(source);
                }
            }
            for (const connection of this.connections)if (connection.attemptTag !== attempt || void 0 === connection.attemptEntry) {
                connection.committed = void 0;
                connection.attemptTag = void 0;
                connection.attemptSource = void 0;
                connection.attemptEntry = void 0;
            }
            if (void 0 !== trackedEntries) for (const [source, entry] of trackedEntries){
                var _this_tracked;
                const existing = null == (_this_tracked = this.tracked) ? void 0 : _this_tracked.get(source);
                if (existing) this.applyDescription(existing, entry);
                else this.ensureTracked().set(source, {
                    committed: this.buildDescription(entry),
                    installed: void 0
                });
            }
            if (void 0 !== touchedConnections) for (const connection of touchedConnections){
                const entry = connection.attemptEntry;
                if (void 0 !== entry) this.applyDescription(connection, entry);
            }
            attempt.tracked = void 0;
            attempt.connections = void 0;
        }
        let changedDuringRender = false;
        if (void 0 !== this.tracked) {
            for (const slot of this.tracked.values())if (this.alignSubscription(this.uid, slot)) changedDuringRender = true;
        }
        for (const connection of this.connections)if (this.alignSubscription(connection.uid, connection)) changedDuringRender = true;
        if (changedDuringRender) this.forceUpdate();
    }
    ensureTracked() {
        if (void 0 === this.tracked) this.tracked = new Map();
        return this.tracked;
    }
    buildDescription(entry) {
        return {
            carburetor: entry.source,
            baselineVersion: entry.baselineVersion,
            reads: entry.reads
        };
    }
    applyDescription(slot, entry) {
        const description = slot.committed;
        if (description) {
            description.carburetor = entry.source;
            description.baselineVersion = entry.baselineVersion;
            description.reads = entry.reads;
        } else slot.committed = this.buildDescription(entry);
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
        const { carburetor, baselineVersion, reads } = committed;
        const version = carburetor.getVersion();
        if (version === baselineVersion) return false;
        const hasDriftSince = carburetor.hasDriftSince;
        return void 0 === hasDriftSince || hasDriftSince.call(carburetor, baselineVersion, reads);
    }
    releaseSlot(uid, slot) {
        if (slot.installed) {
            slot.installed.carburetor.unsubscribe(uid);
            slot.installed = void 0;
        }
    }
    releaseSubscriptions() {
        var _this_tracked;
        null == (_this_tracked = this.tracked) || _this_tracked.forEach((slot)=>{
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
