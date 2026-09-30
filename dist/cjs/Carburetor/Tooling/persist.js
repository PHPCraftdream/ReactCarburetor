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
const persist = (carburetor, options)=>{
    const { key, storage, coalesce } = options;
    let stored;
    try {
        stored = storage.getItem(key);
    } catch (error) {
        if (!options.onError) throw error;
        options.onError(error);
        stored = null;
    }
    if (null !== stored) try {
        carburetor.restore(JSON.parse(stored));
    } catch (error) {
        var _options_onError;
        null == (_options_onError = options.onError) || _options_onError.call(options, error);
        try {
            storage.removeItem(key);
        } catch (removeError) {
            if (options.onError) options.onError(removeError);
            else throw removeError;
        }
    }
    const write = ()=>{
        try {
            storage.setItem(key, carburetor.serialize());
        } catch (error) {
            if (options.onError) options.onError(error);
        }
    };
    if (!coalesce) {
        const id = carburetor.subscribe(write);
        return ()=>carburetor.unsubscribe(id);
    }
    let pending = false;
    const flush = ()=>{
        if (!pending) return;
        pending = false;
        write();
    };
    const id = carburetor.subscribe(()=>{
        if (pending) return;
        pending = true;
        queueMicrotask(flush);
    });
    return ()=>{
        carburetor.unsubscribe(id);
        flush();
    };
};
__webpack_require__.d(__webpack_exports__, {}, {
    persist: persist
});
exports.persist = __webpack_exports__.persist;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "persist"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
