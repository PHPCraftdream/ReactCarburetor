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
const getUid_js_namespaceObject = require("./Utils/getUid.js");
class AntiHookComponent extends external_react_namespaceObject.Component {
    uid = (0, getUid_js_namespaceObject.getUid)();
    lastValues = {};
    tracked = {};
    renderGeneration = 0;
    componentDidMount() {
        this.commitSubscriptions();
        this.useEffects();
    }
    componentDidUpdate(prevProps) {
        this.commitSubscriptions();
        this.unUseEffects(prevProps);
        this.useEffects();
    }
    componentWillUnmount() {
        this.unUseEffects(this.props);
        this.releaseSubscriptions();
    }
    useCarburetor = (carburetor)=>{
        const cuid = carburetor.getUID();
        const known = this.tracked[cuid];
        const tracked = known && known.generation === this.renderGeneration ? known : {
            carburetor,
            reads: new Set(),
            version: carburetor.getVersion(),
            generation: this.renderGeneration
        };
        this.tracked[cuid] = tracked;
        return carburetor.read((path)=>{
            tracked.reads.add(path);
        });
    };
    useEffects() {}
    unUseEffects(_prevProps) {}
    useEffect = (callBack, name, lastValue)=>{
        if (name in this.lastValues) {
            if (this.lastValues[name] === lastValue) return;
        }
        this.lastValues[name] = lastValue;
        callBack();
    };
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
            tracked.carburetor.subscribe(this.onCarburetorUpdate, this.uid, new Set(tracked.reads));
            if (tracked.carburetor.getVersion() !== tracked.version) changedDuringRender = true;
        });
        this.renderGeneration = generation + 1;
        if (changedDuringRender) this.forceUpdate();
    }
    releaseSubscriptions() {
        Object.keys(this.tracked).forEach((cuid)=>{
            this.tracked[cuid].carburetor.unsubscribe(this.uid);
        });
        this.tracked = {};
    }
}
exports.AntiHookComponent = __webpack_exports__.AntiHookComponent;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "AntiHookComponent"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
