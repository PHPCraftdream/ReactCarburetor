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
    AntiHookComponentFoundation: ()=>AntiHookComponentFoundation
});
const external_react_namespaceObject = require("react");
const getUid_js_namespaceObject = require("../../Store/Utils/getUid.js");
const external_shallowEqual_js_namespaceObject = require("../shallowEqual.js");
const renderOwner_js_namespaceObject = require("../../Derived/renderOwner.js");
const RENDER_KEY = "render";
const RENDER_RAW = Symbol('carburetor.antiHookComponent.renderRaw');
const RENDER_BOUNDARY = Symbol('carburetor.antiHookComponent.renderBoundary');
const RENDER_ASSIGNED = Symbol('carburetor.antiHookComponent.renderAssigned');
const describeUnmountFailure = (error)=>error instanceof Error ? error.message : String(error);
class AntiHookComponentFoundation extends external_react_namespaceObject.Component {
    uid = (0, getUid_js_namespaceObject.getUid)();
    effects = void 0;
    tracked = void 0;
    connections = [];
    renderAttempt = void 0;
    pendingAttempt = void 0;
    committedAttempt = void 0;
    [RENDER_RAW] = void 0;
    [RENDER_BOUNDARY] = void 0;
    [RENDER_ASSIGNED] = false;
    installRenderBoundary() {
        Object.defineProperty(this, RENDER_KEY, {
            configurable: false,
            enumerable: false,
            get: AntiHookComponentFoundation.renderGetter,
            set: AntiHookComponentFoundation.renderSetter
        });
    }
    static renderGetter() {
        const raw = this[RENDER_ASSIGNED] ? this[RENDER_RAW] : Reflect.get(Object.getPrototypeOf(this), RENDER_KEY, this);
        if ('function' != typeof raw) return raw;
        if (void 0 === this[RENDER_BOUNDARY] || raw !== this[RENDER_RAW]) {
            this[RENDER_RAW] = raw;
            this[RENDER_BOUNDARY] = this.buildRenderBoundary(raw);
        }
        return this[RENDER_BOUNDARY];
    }
    static renderSetter(value) {
        this[RENDER_ASSIGNED] = 'function' == typeof value;
        this[RENDER_RAW] = value;
        this[RENDER_BOUNDARY] = this[RENDER_ASSIGNED] ? this.buildRenderBoundary(value) : void 0;
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
        try {
            this.unUseEffects(this.props);
        } catch (error) {
            failures.push("the component-wide unUseEffects callback threw while a component unmounted: " + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }
        try {
            this.releaseEffects();
        } catch (error) {
            failures.push('an effect cleanup threw while a component unmounted: ' + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }
        try {
            this.releaseSubscriptions();
        } catch (error) {
            failures.push("releasing subscriptions threw while a component unmounted: " + describeUnmountFailure(error) + '. The teardown completed anyway.');
        }
        for(let i = 0; i < failures.length; i++)this.reportTeardownFailure(failures[i]);
    }
    buildRenderBoundary(realRender) {
        return ()=>{
            const attempt = this.openRenderAttempt();
            const development = "u" > typeof process && 'production' !== process.env.NODE_ENV;
            const previousOwner = development ? renderOwner_js_namespaceObject.renderOwner.get() : void 0;
            if (development) renderOwner_js_namespaceObject.renderOwner.set({
                uid: this.uid,
                hasTracked: (source)=>void 0 !== attempt.tracked && attempt.tracked.has(source)
            });
            try {
                return realRender.call(this);
            } catch (error) {
                attempt.abandoned = true;
                throw error;
            } finally{
                if (development) renderOwner_js_namespaceObject.renderOwner.set(previousOwner);
                this.closeRenderAttempt(attempt);
            }
        };
    }
    openRenderAttempt() {
        const attempt = {
            tracked: void 0,
            connections: void 0,
            deferredLoads: void 0,
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
