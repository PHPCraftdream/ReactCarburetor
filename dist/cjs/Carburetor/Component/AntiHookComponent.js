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
const liveViews_js_namespaceObject = require("../Store/Tracking/liveViews.js");
const DevelopmentFlag_js_namespaceObject = require("../Store/Utils/DevelopmentFlag.js");
const external_shallowEqual_js_namespaceObject = require("./shallowEqual.js");
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
const isPlainObject = (value)=>{
    if ('object' != typeof value || null === value || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return null === prototype || prototype === Object.prototype;
};
const sameSelection = (snapshot, next)=>{
    if (Object.is(snapshot, next)) return true;
    const snapshotIsArray = Array.isArray(snapshot);
    const nextIsArray = Array.isArray(next);
    if (snapshotIsArray || nextIsArray) {
        if (!snapshotIsArray || !nextIsArray) return false;
        const previousMembers = snapshot;
        const freshMembers = next;
        return previousMembers.length === freshMembers.length && previousMembers.every((member, index)=>Object.is(member, freshMembers[index]));
    }
    if (!isPlainObject(snapshot) || !isPlainObject(next)) return false;
    const previousKeys = Object.keys(snapshot);
    const freshKeys = Object.keys(next);
    if (previousKeys.length !== freshKeys.length) return false;
    const previousMembers = snapshot;
    const freshMembers = next;
    return previousKeys.every((key)=>Object.is(previousMembers[key], freshMembers[key]));
};
const detachSelection = (value)=>{
    if (Array.isArray(value)) return Array.from(value);
    if (isPlainObject(value)) return {
        ...value
    };
    return value;
};
const reportLiveViewEscape = (next)=>{
    const guidance = "A child reading it in its own render records nothing, so no subscription covers what it sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays built from them.";
    if (liveViews_js_namespaceObject.liveViews.has(next)) {
        DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view as its whole value. ' + guidance);
        return true;
    }
    if (Array.isArray(next)) {
        const index = next.findIndex((member)=>liveViews_js_namespaceObject.liveViews.has(member));
        if (-1 !== index) {
            DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view as array member ' + index + '. ' + guidance);
            return true;
        }
        return false;
    }
    if (isPlainObject(next)) {
        const members = next;
        const key = Object.keys(members).find((memberKey)=>liveViews_js_namespaceObject.liveViews.has(members[memberKey]));
        if (void 0 !== key) {
            DiagnosticsInstance_js_namespaceObject.diagnostics.report('a connectSelection() snapshot handed a child a live store view as member "' + key + '". ' + guidance);
            return true;
        }
    }
    return false;
};
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
    staleResources = [];
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
        this.unUseEffects(this.props);
        this.releaseEffects();
        this.releaseSubscriptions();
    }
    useCarburetor = (carburetor)=>{
        const attempt = this.renderAttempt;
        const entry = this.track(carburetor);
        return carburetor.read((path)=>{
            if (void 0 !== attempt && this.renderAttempt === attempt) entry.reads.add(path);
        });
    };
    connect = (source)=>{
        const getCarburetor = 'function' == typeof source ? source : ()=>source;
        const connection = {
            uid: (0, getUid_js_namespaceObject.getUid)(),
            getCarburetor,
            committed: void 0,
            installed: void 0
        };
        this.connections.push(connection);
        const resolveAttemptSource = ()=>{
            const attempt = this.renderAttempt;
            if (!attempt) return getCarburetor();
            const key = CONNECTION_ATTEMPT_KEY + connection.uid;
            const resolved = attempt.sources.get(key);
            if (void 0 !== resolved) return resolved;
            const carburetor = getCarburetor();
            attempt.sources.set(key, carburetor);
            return carburetor;
        };
        const recorder = (path)=>{
            const attempt = this.renderAttempt;
            if (!attempt) return;
            let entry = attempt.entries.get(CONNECTION_ATTEMPT_KEY + connection.uid);
            if (!entry) {
                const carburetor = resolveAttemptSource();
                entry = {
                    connection,
                    source: carburetor,
                    baselineVersion: carburetor.getVersion(),
                    reads: new Set()
                };
                attempt.entries.set(CONNECTION_ATTEMPT_KEY + connection.uid, entry);
            }
            entry.reads.add(path);
        };
        return this.buildPersistentView(getCarburetor, recorder, resolveAttemptSource);
    };
    buildPersistentView = (getCarburetor, recorder, resolveAttemptSource)=>{
        let cachedTarget;
        let cachedView;
        let arrayFacade = false;
        try {
            arrayFacade = Array.isArray(getCarburetor().getData());
        } catch  {}
        const assertDeclaredKind = (data)=>{
            if (Array.isArray(data) === arrayFacade) return;
            throw new Error(arrayFacade ? "Carburetor: this connect() view was declared for an array root, but its source now resolves to a root that is not an array. One persistent view cannot change its object/array kind; declare a separate connection for the other store." : "Carburetor: this connect() view is fixed as an object view because its source was not resolvable at declaration time (a scope-backed resolver resolves after construction), but the resolved root is an array. Read an array-rooted scoped store through useCarburetor in render instead.");
        };
        const resolveView = ()=>{
            const carburetor = resolveAttemptSource();
            const data = carburetor.getData();
            if (cachedTarget !== data) {
                assertDeclaredKind(data);
                cachedTarget = data;
                cachedView = carburetor.read(recorder);
            }
            return cachedView;
        };
        const forbidWrite = ()=>{
            throw new Error("Carburetor: data read through connect() is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
        };
        const facade = new Proxy(arrayFacade ? [] : {}, {
            get: (_target, key)=>Reflect.get(resolveView(), key),
            has: (_target, key)=>Reflect.has(resolveView(), key),
            ownKeys: (_target)=>Reflect.ownKeys(resolveView()),
            getOwnPropertyDescriptor: (_target, key)=>{
                const descriptor = Reflect.getOwnPropertyDescriptor(resolveView(), key);
                if (void 0 === descriptor || descriptor.configurable) return descriptor;
                const targetDescriptor = Reflect.getOwnPropertyDescriptor(_target, key);
                if (void 0 !== targetDescriptor && !targetDescriptor.configurable) return descriptor;
                return {
                    ...descriptor,
                    configurable: true
                };
            },
            getPrototypeOf: (_target)=>Reflect.getPrototypeOf(resolveView()),
            setPrototypeOf: forbidWrite,
            preventExtensions: forbidWrite,
            set: forbidWrite,
            deleteProperty: forbidWrite,
            defineProperty: forbidWrite
        });
        liveViews_js_namespaceObject.liveViews.note(facade);
        return facade;
    };
    connectSelection = (source, select)=>{
        const getCarburetor = 'function' == typeof source ? source : ()=>source;
        const connection = {
            uid: (0, getUid_js_namespaceObject.getUid)(),
            getCarburetor,
            committed: void 0,
            installed: void 0
        };
        this.connections.push(connection);
        const resolveAttemptSource = ()=>{
            const attempt = this.renderAttempt;
            if (!attempt) return getCarburetor();
            const key = CONNECTION_ATTEMPT_KEY + connection.uid;
            const resolved = attempt.sources.get(key);
            if (void 0 !== resolved) return resolved;
            const carburetor = getCarburetor();
            attempt.sources.set(key, carburetor);
            return carburetor;
        };
        const recorder = (path)=>{
            const attempt = this.renderAttempt;
            if (!attempt) return;
            let entry = attempt.entries.get(CONNECTION_ATTEMPT_KEY + connection.uid);
            if (!entry) {
                const carburetor = resolveAttemptSource();
                entry = {
                    connection,
                    source: carburetor,
                    baselineVersion: carburetor.getVersion(),
                    reads: new Set()
                };
                attempt.entries.set(CONNECTION_ATTEMPT_KEY + connection.uid, entry);
            }
            entry.reads.add(path);
        };
        const view = this.buildPersistentView(getCarburetor, recorder, resolveAttemptSource);
        let snapshot;
        let escapeReported = false;
        return ()=>{
            const next = select(view);
            if (DevelopmentFlag_js_namespaceObject.IS_DEVELOPMENT && !escapeReported) escapeReported = reportLiveViewEscape(next);
            if (void 0 !== snapshot && sameSelection(snapshot.value, next)) return snapshot.value;
            snapshot = {
                value: detachSelection(next)
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
        if (worthFetching) this.staleResources.push(()=>{
            source.load(args);
        });
        return view;
    };
    loadStaleResources() {
        const queued = this.staleResources;
        this.staleResources = [];
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
    useEffect = (callBack, name, deps)=>{
        const known = this.effects[name];
        if (known && (0, external_shallowEqual_js_namespaceObject.shallowEqual)(known.deps, deps)) return;
        if (known && known.cleanup) known.cleanup();
        const cleanup = callBack();
        this.effects[name] = {
            deps,
            cleanup: 'function' == typeof cleanup ? cleanup : void 0
        };
    };
    releaseEffects() {
        Object.keys(this.effects).forEach((name)=>{
            const cleanup = this.effects[name].cleanup;
            if (cleanup) cleanup();
        });
        this.effects = {};
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
