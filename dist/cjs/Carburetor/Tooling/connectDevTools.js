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
    connectDevTools: ()=>connectDevTools
});
const getUid_js_namespaceObject = require("../Store/getUid.js");
const WildcardPath_js_namespaceObject = require("../Store/Paths/WildcardPath.js");
const findExtension = ()=>{
    const host = globalThis;
    return host.__REDUX_DEVTOOLS_EXTENSION__;
};
const composeState = (carburetors)=>{
    const state = {};
    Object.keys(carburetors).forEach((name)=>{
        state[name] = carburetors[name].toJSON();
    });
    return state;
};
const connectDevTools = (carburetors, options = {})=>{
    const extension = options.extension || findExtension();
    if (!extension) return ()=>void 0;
    const connection = extension.connect({
        name: options.name || 'React Carburetor'
    });
    const subscriberId = (0, getUid_js_namespaceObject.getUid)();
    const names = Object.keys(carburetors);
    let applyingTimeTravel = false;
    connection.init(composeState(carburetors));
    const publish = (name)=>{
        if (applyingTimeTravel) return;
        connection.send(name + '/update', composeState(carburetors));
    };
    names.forEach((name)=>{
        carburetors[name].subscribe(()=>publish(name), subscriberId, new Set([
            WildcardPath_js_namespaceObject.WILDCARD_PATH
        ]));
    });
    const applyState = (serialized)=>{
        if (!serialized) return;
        const next = JSON.parse(serialized);
        applyingTimeTravel = true;
        try {
            names.forEach((name)=>{
                if (name in next) carburetors[name].fromJSON(next[name]);
            });
        } finally{
            applyingTimeTravel = false;
        }
    };
    const unsubscribeFromExtension = connection.subscribe((message)=>{
        if ('DISPATCH' !== message.type || !message.payload) return;
        const action = message.payload.type;
        if ('JUMP_TO_ACTION' === action || 'JUMP_TO_STATE' === action || 'ROLLBACK' === action) applyState(message.state);
    });
    return ()=>{
        names.forEach((name)=>carburetors[name].unsubscribe(subscriberId));
        if ('function' == typeof unsubscribeFromExtension) unsubscribeFromExtension();
    };
};
exports.connectDevTools = __webpack_exports__.connectDevTools;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "connectDevTools"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
