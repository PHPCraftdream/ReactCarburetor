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
const external_shallowEqual_js_namespaceObject = require("./shallowEqual.js");
const sameReads = (a, b)=>{
    if (a.size !== b.size) return false;
    for (const path of a)if (!b.has(path)) return false;
    return true;
};
class AntiHookComponent extends external_react_namespaceObject.Component {
    uid = (0, getUid_js_namespaceObject.getUid)();
    effects = {};
    tracked = {};
    connections = [];
    renderGeneration = 0;
    staleResources = [];
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
        const tracked = this.track(carburetor);
        return carburetor.read((path)=>{
            tracked.reads.add(path);
        });
    };
    connect = (source)=>{
        const getCarburetor = 'function' == typeof source ? source : ()=>source;
        const connection = {
            uid: (0, getUid_js_namespaceObject.getUid)(),
            getCarburetor,
            subscribedTo: void 0,
            reads: new Set(),
            generation: -1,
            committed: void 0,
            lastSeenVersion: void 0
        };
        this.connections.push(connection);
        const recorder = (path)=>{
            if (connection.generation !== this.renderGeneration) {
                connection.reads = new Set();
                connection.generation = this.renderGeneration;
            }
            connection.reads.add(path);
            connection.lastSeenVersion = getCarburetor().getVersion();
        };
        let cachedTarget;
        let cachedView;
        const resolveView = ()=>{
            const carburetor = getCarburetor();
            const data = carburetor.getData();
            if (cachedTarget !== data) {
                cachedTarget = data;
                cachedView = carburetor.read(recorder);
            }
            return cachedView;
        };
        const forbidWrite = ()=>{
            throw new Error("Carburetor: data read through connect() is read-only. Write through carburetor methods — they write via draft and know which paths changed.");
        };
        return new Proxy({}, {
            get: (_target, key)=>Reflect.get(resolveView(), key),
            has: (_target, key)=>Reflect.has(resolveView(), key),
            ownKeys: (_target)=>Reflect.ownKeys(resolveView()),
            getOwnPropertyDescriptor: (_target, key)=>Reflect.getOwnPropertyDescriptor(resolveView(), key),
            set: forbidWrite,
            deleteProperty: forbidWrite,
            defineProperty: forbidWrite
        });
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
    track(source) {
        const cuid = source.getUID();
        const known = this.tracked[cuid];
        const tracked = known && known.generation === this.renderGeneration ? known : {
            carburetor: source,
            reads: new Set(),
            version: source.getVersion(),
            generation: this.renderGeneration,
            committed: known ? known.committed : void 0
        };
        this.tracked[cuid] = tracked;
        return tracked;
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
        const generation = this.renderGeneration;
        let changedDuringRender = false;
        Object.keys(this.tracked).forEach((cuid)=>{
            const tracked = this.tracked[cuid];
            if (tracked.generation !== generation) {
                tracked.carburetor.unsubscribe(this.uid);
                delete this.tracked[cuid];
                return;
            }
            if (void 0 === tracked.committed || !sameReads(tracked.committed, tracked.reads)) {
                tracked.carburetor.subscribe(this.onCarburetorUpdate, {
                    id: this.uid,
                    reads: tracked.reads
                });
                tracked.committed = new Set(tracked.reads);
            }
            if (tracked.carburetor.getVersion() !== tracked.version) changedDuringRender = true;
        });
        this.connections.forEach((connection)=>{
            const carburetor = connection.getCarburetor();
            if (connection.subscribedTo !== carburetor) {
                if (connection.subscribedTo) connection.subscribedTo.unsubscribe(connection.uid);
                connection.committed = void 0;
                connection.subscribedTo = carburetor;
            }
            if (void 0 === connection.committed || !sameReads(connection.committed, connection.reads)) {
                carburetor.subscribe(this.onCarburetorUpdate, {
                    id: connection.uid,
                    reads: connection.reads
                });
                connection.committed = new Set(connection.reads);
            }
            if (void 0 !== connection.lastSeenVersion && carburetor.getVersion() !== connection.lastSeenVersion) changedDuringRender = true;
        });
        this.renderGeneration = generation + 1;
        if (changedDuringRender) this.forceUpdate();
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
            this.tracked[cuid].generation = this.renderGeneration;
            this.tracked[cuid].committed = void 0;
        });
        this.connections.forEach((connection)=>{
            if (connection.subscribedTo) connection.subscribedTo.unsubscribe(connection.uid);
            connection.subscribedTo = void 0;
            connection.committed = void 0;
        });
    }
}
exports.AntiHookComponent = __webpack_exports__.AntiHookComponent;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponent"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
