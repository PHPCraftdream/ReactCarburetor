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
    buildPersistentView: ()=>buildPersistentView
});
const liveViews_js_namespaceObject = require("../../Store/Tracking/liveViews.js");
const buildPersistentView = (source)=>{
    const { getCarburetor, recorder, resolveAttemptSource } = source;
    let cachedTarget;
    let cachedView;
    let arrayFacade = false;
    let probeError;
    try {
        arrayFacade = Array.isArray(getCarburetor().getData());
    } catch (error) {
        probeError = error;
    }
    const assertDeclaredKind = (data)=>{
        if (Array.isArray(data) === arrayFacade) return;
        const mismatch = new Error(arrayFacade ? "Carburetor: this connect() view was declared for an array root, but its source now resolves to a root that is not an array. One persistent view cannot change its object/array kind; declare a separate connection for the other store." : void 0 === probeError ? "Carburetor: this connect() view is fixed as an object view because its source was not resolvable at declaration time (a scope-backed resolver resolves after construction), but the resolved root is an array. Read an array-rooted scoped store through useCarburetor in render instead." : 'Carburetor: this connect() view is fixed as an object view because reading its source threw during declaration (see this error\'s "cause") — a scope-backed resolver not yet ready throws the same way, but this may instead be a genuine resolver bug — and the resolved root is now an array. Read an array-rooted scoped store through useCarburetor in render instead.');
        if (void 0 !== probeError) mismatch.cause = probeError;
        throw mismatch;
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
exports.buildPersistentView = __webpack_exports__.buildPersistentView;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "buildPersistentView"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
