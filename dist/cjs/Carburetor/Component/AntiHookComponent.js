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
class AntiHookComponent extends external_react_namespaceObject.Component {
    uid = (0, getUid_js_namespaceObject.getUid)();
    effects = {};
    tracked = {};
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
    useComputed = (computed)=>{
        this.track(computed).reads.add(WildcardPath_js_namespaceObject.WILDCARD_PATH);
        return computed.get();
    };
    useResource = (source, args)=>{
        this.track(source).reads.add(source.pathOf(args));
        const view = source.getEntry(args);
        const worthFetching = view.stale && !view.refreshing && view.status !== EResourceStatus_js_namespaceObject.EResourceStatus.Error;
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
            generation: this.renderGeneration
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
            tracked.carburetor.subscribe(this.onCarburetorUpdate, {
                id: this.uid,
                reads: tracked.reads
            });
            if (tracked.carburetor.getVersion() !== tracked.version) changedDuringRender = true;
        });
        this.renderGeneration = generation + 1;
        if (changedDuringRender) this.forceUpdate();
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
            this.tracked[cuid].generation = this.renderGeneration;
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
