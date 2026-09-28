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
    AntiHookComponentFoundation: ()=>AntiHookComponentFoundation
});
const external_react_namespaceObject = require("react");
const getUid_js_namespaceObject = require("../../Store/Utils/getUid.js");
const external_shallowEqual_js_namespaceObject = require("../shallowEqual.js");
const RENDER_KEY = "render";
class AntiHookComponentFoundation extends external_react_namespaceObject.Component {
    uid = (0, getUid_js_namespaceObject.getUid)();
    effects = {};
    tracked = {};
    connections = [];
    renderAttempt = void 0;
    pendingAttempt = void 0;
    committedAttempt = void 0;
    installRenderBoundary() {
        let rawRender;
        let boundary;
        let assigned = false;
        Object.defineProperty(this, RENDER_KEY, {
            configurable: false,
            enumerable: false,
            get: ()=>{
                const raw = assigned ? rawRender : Reflect.get(Object.getPrototypeOf(this), RENDER_KEY, this);
                if ('function' != typeof raw) return raw;
                if (void 0 === boundary || raw !== rawRender) {
                    rawRender = raw;
                    boundary = this.buildRenderBoundary(raw);
                }
                return boundary;
            },
            set: (value)=>{
                assigned = 'function' == typeof value;
                rawRender = value;
                boundary = assigned ? this.buildRenderBoundary(value) : void 0;
            }
        });
    }
    constructor(props){
        super(props);
        this.installRenderBoundary();
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
}
exports.AntiHookComponentFoundation = __webpack_exports__.AntiHookComponentFoundation;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponentFoundation"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
