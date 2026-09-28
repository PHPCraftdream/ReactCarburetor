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
    AntiHookComponentReads: ()=>AntiHookComponentReads
});
const EResourceStatus_js_namespaceObject = require("../../Models/Enums/EResourceStatus.js");
const WildcardPath_js_namespaceObject = require("../../Store/Paths/WildcardPath.js");
const DiagnosticsInstance_js_namespaceObject = require("../../Store/Diagnostics/DiagnosticsInstance.js");
const DevelopmentFlag_js_namespaceObject = require("../../Store/Utils/DevelopmentFlag.js");
const external_buildTrackedView_js_namespaceObject = require("./buildTrackedView.js");
const buildPersistentView_js_namespaceObject = require("../Connection/buildPersistentView.js");
const declareConnection_js_namespaceObject = require("../Connection/declareConnection.js");
const detachSelection_js_namespaceObject = require("../Connection/detachSelection.js");
const reportLiveViewEscape_js_namespaceObject = require("../Connection/reportLiveViewEscape.js");
const sameSelection_js_namespaceObject = require("../Connection/sameSelection.js");
const external_Foundation_js_namespaceObject = require("./Foundation.js");
class AntiHookComponentReads extends external_Foundation_js_namespaceObject.AntiHookComponentFoundation {
    trackedViews;
    getRenderAttempt = ()=>this.renderAttempt;
    useCarburetor(carburetor) {
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);
        if (void 0 === this.trackedViews) this.trackedViews = new WeakMap();
        return (0, external_buildTrackedView_js_namespaceObject.buildTrackedView)(this.trackedViews, carburetor, this.getRenderAttempt, attempt, entry);
    }
    declareConnection(source) {
        return (0, declareConnection_js_namespaceObject.declareConnection)(this.connections, this.getRenderAttempt, source);
    }
    connect(source) {
        const declared = this.declareConnection(source);
        return (0, buildPersistentView_js_namespaceObject.buildPersistentView)(declared);
    }
    connectSelection(source, select) {
        const declared = this.declareConnection(source);
        const view = (0, buildPersistentView_js_namespaceObject.buildPersistentView)(declared);
        let snapshot;
        let escapeReported = false;
        return ()=>{
            const next = select(view);
            if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT && !escapeReported) escapeReported = (0, reportLiveViewEscape_js_namespaceObject.reportLiveViewEscape)(next);
            if (void 0 !== snapshot && (0, sameSelection_js_namespaceObject.sameSelection)(snapshot.value, next)) return snapshot.value;
            snapshot = {
                value: (0, detachSelection_js_namespaceObject.detachSelection)(next)
            };
            return snapshot.value;
        };
    }
    useComputed(computed) {
        this.track(computed).reads.add(WildcardPath_js_namespaceObject.WILDCARD_PATH);
        return computed.get();
    }
    useResource(source, args) {
        const { path, view } = source.resolve(args);
        this.track(source).reads.add(path);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus_js_namespaceObject.EResourceStatus.Error && !view.failed;
        const attempt = this.renderAttempt;
        if (worthFetching) {
            if (attempt) {
                if (void 0 === attempt.deferredLoads) attempt.deferredLoads = [];
                attempt.deferredLoads.push(()=>{
                    source.load(args);
                });
            } else if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) DiagnosticsInstance_js_namespaceObject.diagnostics.report('useResource() skipped the deferred load for entry ' + path + " because it ran outside a render attempt. That is the only place a deferred load can be attributed to a commit: run useResource() inside render(), the way every other read API is meant to run, or refresh the entry from an effect.");
        }
        return view;
    }
    loadStaleResources() {
        const attempt = this.pendingAttempt;
        if (void 0 === attempt || attempt.abandoned || attempt !== this.committedAttempt) return;
        const queued = attempt.deferredLoads;
        if (void 0 === queued) return;
        attempt.deferredLoads = void 0;
        queued.forEach((load)=>load());
    }
    track(source) {
        const attempt = this.renderAttempt;
        if (!attempt) return {
            source,
            baselineVersion: source.getVersion(),
            reads: new Set()
        };
        let tracked = attempt.tracked;
        if (void 0 === tracked) {
            tracked = new Map();
            attempt.tracked = tracked;
        }
        let entry = tracked.get(source);
        if (!entry) {
            entry = {
                source,
                baselineVersion: source.getVersion(),
                reads: new Set()
            };
            tracked.set(source, entry);
        }
        return entry;
    }
}
exports.AntiHookComponentReads = __webpack_exports__.AntiHookComponentReads;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponentReads"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
