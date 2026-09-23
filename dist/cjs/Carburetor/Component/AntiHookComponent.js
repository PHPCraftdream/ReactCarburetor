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
    AntiHookComponent: ()=>AntiHookComponent
});
const external_react_namespaceObject = require("react");
const EResourceStatus_js_namespaceObject = require("../Models/Enums/EResourceStatus.js");
const getUid_js_namespaceObject = require("../Store/Utils/getUid.js");
const WildcardPath_js_namespaceObject = require("../Store/Paths/WildcardPath.js");
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
const DevelopmentFlag_js_namespaceObject = require("../Store/Utils/DevelopmentFlag.js");
const buildPersistentView_js_namespaceObject = require("./Connection/buildPersistentView.js");
const declareConnection_js_namespaceObject = require("./Connection/declareConnection.js");
const detachSelection_js_namespaceObject = require("./Connection/detachSelection.js");
const reportLiveViewEscape_js_namespaceObject = require("./Connection/reportLiveViewEscape.js");
const sameSelection_js_namespaceObject = require("./Connection/sameSelection.js");
const external_shallowEqual_js_namespaceObject = require("./shallowEqual.js");
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const describeFailure = (error)=>error instanceof Error ? error.message : String(error);
const CONNECTION_ATTEMPT_KEY = 'c:';
const TRACKED_ATTEMPT_KEY = 't:';
const RENDER_KEY = 'render';
class AntiHookComponent extends external_react_namespaceObject.Component {
    uid = (0, getUid_js_namespaceObject.getUid)();
    effects = {};
    tracked = {};
    connections = [];
    renderAttempt = void 0;
    pendingAttempt = void 0;
    committedAttempt = void 0;
    constructor(props){
        super(props);
        return this.withRenderBoundary();
    }
    shouldComponentUpdate(nextProps, nextState) {
        return !(0, external_shallowEqual_js_namespaceObject.shallowEqual)(this.props, nextProps) || !(0, external_shallowEqual_js_namespaceObject.shallowEqual)(this.state, nextState);
    }
    componentDidMount() {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.useEffects();
    }
    componentDidUpdate(prevProps) {
        this.commitSubscriptions();
        this.loadStaleResources();
        this.unUseEffects(prevProps);
        this.useEffects();
    }
    componentWillUnmount() {
        const failures = [];
        this.runTeardownStage("the component-wide unUseEffects callback threw while a component unmounted", ()=>this.unUseEffects(this.props), failures);
        this.runTeardownStage('an effect cleanup threw while a component unmounted', ()=>this.releaseEffects(), failures);
        this.runTeardownStage("releasing subscriptions threw while a component unmounted", ()=>this.releaseSubscriptions(), failures);
        failures.forEach((failure)=>this.reportTeardownFailure(failure));
    }
    useCarburetor = (carburetor)=>{
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);
        return carburetor.read((path)=>{
            if (void 0 !== attempt && this.renderAttempt === attempt) entry.reads.add(path);
        });
    };
    declareConnection = (source)=>(0, declareConnection_js_namespaceObject.declareConnection)(this.connections, CONNECTION_ATTEMPT_KEY, ()=>this.renderAttempt, source);
    connect = (source)=>(0, buildPersistentView_js_namespaceObject.buildPersistentView)(this.declareConnection(source));
    connectSelection = (source, select)=>{
        const view = (0, buildPersistentView_js_namespaceObject.buildPersistentView)(this.declareConnection(source));
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
    };
    useComputed = (computed)=>{
        this.track(computed).reads.add(WildcardPath_js_namespaceObject.WILDCARD_PATH);
        return computed.get();
    };
    useResource = (source, args)=>{
        this.track(source).reads.add(source.pathOf(args));
        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus_js_namespaceObject.EResourceStatus.Error && !view.failed;
        const attempt = this.renderAttempt;
        if (worthFetching) {
            if (attempt) attempt.deferredLoads.push(()=>{
                source.load(args);
            });
            else if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT) DiagnosticsInstance_js_namespaceObject.diagnostics.report('useResource() skipped the deferred load for entry ' + source.pathOf(args) + " because it ran outside a render attempt. That is the only place a deferred load can be attributed to a commit: run useResource() inside render(), the way every other read API is meant to run, or refresh the entry from an effect.");
        }
        return view;
    };
    loadStaleResources() {
        const attempt = this.pendingAttempt;
        if (void 0 === attempt || attempt.abandoned || attempt !== this.committedAttempt) return;
        const queued = attempt.deferredLoads;
        attempt.deferredLoads = [];
        queued.forEach((load)=>load());
    }
    withRenderBoundary() {
        let rawRender;
        let boundary;
        let wrapped = false;
        const proxy = new Proxy(this, {
            get: (target, key)=>{
                if (key !== RENDER_KEY) return Reflect.get(target, key, target);
                const raw = wrapped ? rawRender : Reflect.get(target, RENDER_KEY, target);
                if ('function' != typeof raw) return raw;
                if (void 0 === boundary || rawRender !== raw) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw);
                }
                return boundary;
            },
            set: (target, key, value)=>{
                if (key !== RENDER_KEY) return Reflect.set(target, key, value, target);
                rawRender = value;
                wrapped = 'function' == typeof value;
                boundary = wrapped ? this.buildRenderBoundary(value) : void 0;
                return true;
            },
            defineProperty: (target, key, descriptor)=>{
                if (key !== RENDER_KEY) return Reflect.defineProperty(target, key, descriptor);
                rawRender = descriptor.value;
                wrapped = 'function' == typeof descriptor.value;
                boundary = wrapped ? this.buildRenderBoundary(descriptor.value) : void 0;
                return true;
            },
            deleteProperty: (target, key)=>{
                if (key === RENDER_KEY) {
                    rawRender = void 0;
                    boundary = void 0;
                    wrapped = false;
                }
                return Reflect.deleteProperty(target, key);
            },
            has: (target, key)=>key === RENDER_KEY ? wrapped || Reflect.has(target, RENDER_KEY) : Reflect.has(target, key)
        });
        return proxy;
    }
    buildRenderBoundary(realRender) {
        return ()=>{
            const attempt = this.openRenderAttempt();
            try {
                return realRender.call(this);
            } catch (error) {
                attempt.abandoned = true;
                throw error;
            } finally{
                this.closeRenderAttempt(attempt);
            }
        };
    }
    openRenderAttempt() {
        const attempt = {
            entries: new Map(),
            sources: new Map(),
            deferredLoads: [],
            abandoned: false
        };
        this.renderAttempt = attempt;
        return attempt;
    }
    closeRenderAttempt(attempt) {
        this.pendingAttempt = attempt;
        this.renderAttempt = void 0;
    }
    track(source) {
        const attempt = this.renderAttempt;
        if (!attempt) return {
            connection: void 0,
            source,
            baselineVersion: source.getVersion(),
            reads: new Set()
        };
        const cuid = source.getUID();
        let entry = attempt.entries.get(TRACKED_ATTEMPT_KEY + cuid);
        if (!entry) {
            entry = {
                connection: void 0,
                source,
                baselineVersion: source.getVersion(),
                reads: new Set()
            };
            attempt.entries.set(TRACKED_ATTEMPT_KEY + cuid, entry);
        }
        return entry;
    }
    useEffects() {}
    unUseEffects(_prevProps) {}
    reportTeardownFailure = (failure)=>{
        if ("u" > typeof process && 'production' !== process.env.NODE_ENV) DiagnosticsInstance_js_namespaceObject.diagnostics.report(failure);
    };
    runTeardownStage = (what, stage, failures)=>{
        try {
            stage();
        } catch (error) {
            failures.push(what + ': ' + describeFailure(error) + '. The teardown completed anyway.');
        }
    };
    useEffect = (callBack, name, deps)=>{
        const known = this.effects[name];
        if (known && (0, external_shallowEqual_js_namespaceObject.shallowEqual)(known.deps, deps)) return;
        const failures = [];
        if (known && known.cleanup) try {
            known.cleanup();
        } catch (error) {
            failures.push(error);
        }
        const record = {
            deps,
            cleanup: void 0
        };
        this.effects[name] = record;
        try {
            const cleanup = callBack();
            record.cleanup = 'function' == typeof cleanup ? cleanup : void 0;
        } finally{
            failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while an effect was replaced: ' + describeFailure(error) + '. The new effect ran anyway.'));
        }
    };
    releaseEffects() {
        const records = this.effects;
        this.effects = {};
        const failures = [];
        Object.keys(records).forEach((name)=>{
            const cleanup = records[name].cleanup;
            if (cleanup) try {
                cleanup();
            } catch (error) {
                failures.push(error);
            }
        });
        failures.forEach((error)=>this.reportTeardownFailure('an effect cleanup threw while a component unmounted: ' + describeFailure(error) + '. The teardown completed anyway.'));
    }
    onCarburetorUpdate = ()=>{
        this.forceUpdate();
    };
    commitSubscriptions() {
        const attempt = this.pendingAttempt;
        const fresh = void 0 !== attempt && !attempt.abandoned && attempt !== this.committedAttempt;
        if (fresh) {
            this.committedAttempt = attempt;
            Object.keys(this.tracked).forEach((cuid)=>{
                if (attempt.entries.has(TRACKED_ATTEMPT_KEY + cuid)) return;
                this.releaseSlot(this.uid, this.tracked[cuid]);
                delete this.tracked[cuid];
            });
            this.connections.forEach((connection)=>{
                if (!attempt.entries.has(CONNECTION_ATTEMPT_KEY + connection.uid)) connection.committed = void 0;
            });
            attempt.entries.forEach((entry, key)=>{
                const description = {
                    carburetor: entry.source,
                    baselineVersion: entry.baselineVersion,
                    reads: new Set(entry.reads)
                };
                if (entry.connection) {
                    entry.connection.committed = description;
                    return;
                }
                const cuid = key.slice(TRACKED_ATTEMPT_KEY.length);
                const known = this.tracked[cuid];
                this.tracked[cuid] = {
                    committed: description,
                    installed: known ? known.installed : void 0
                };
            });
        }
        let changedDuringRender = false;
        Object.keys(this.tracked).forEach((cuid)=>{
            if (this.alignSubscription(this.uid, this.tracked[cuid])) changedDuringRender = true;
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
                reads: new Set(committed.reads)
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
        Object.keys(this.tracked).forEach((cuid)=>{
            this.releaseSlot(this.uid, this.tracked[cuid]);
        });
        this.connections.forEach((connection)=>{
            this.releaseSlot(connection.uid, connection);
        });
        this.renderAttempt = void 0;
    }
}
exports.AntiHookComponent = __webpack_exports__.AntiHookComponent;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponent"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
