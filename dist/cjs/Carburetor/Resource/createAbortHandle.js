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
    createAbortHandle: ()=>createAbortHandle
});
const DiagnosticsInstance_js_namespaceObject = require("../Store/Diagnostics/DiagnosticsInstance.js");
let reported = false;
const createAbortHandle = ()=>{
    if ('function' == typeof AbortController) return new AbortController();
    if ("u" > typeof process && 'production' !== process.env.NODE_ENV && !reported) {
        reported = true;
        DiagnosticsInstance_js_namespaceObject.diagnostics.report("this runtime has no AbortController (Node added one in 14.17.0; the advertised floor is 14.6.0), so cancellation degrades: the stand-in signal honors abort(), fires the abort listeners a loader registered, and still keeps a late answer from being stored, but it is not a native AbortSignal, so an API that demands native signal identity (fetch, for one) rejects it and nothing interrupts the request itself.");
    }
    const listeners = [];
    const signal = {
        aborted: false
    };
    const addEventListener = (type, listener)=>{
        if ('abort' !== type || signal.aborted || -1 !== listeners.indexOf(listener)) return;
        listeners.push(listener);
    };
    const removeEventListener = (type, listener)=>{
        if ('abort' !== type) return;
        const at = listeners.indexOf(listener);
        if (-1 === at) return;
        listeners.splice(at, 1);
    };
    let onAbort = null;
    const invoke = (listener, event)=>{
        if ('function' == typeof listener) return void listener(event);
        listener.handleEvent(event);
    };
    const throwIfAborted = ()=>{
        if (signal.aborted) {
            const error = new Error('This operation was aborted');
            error.name = 'AbortError';
            throw error;
        }
    };
    const reportListenerError = (error)=>{
        if ("u" < typeof process || 'production' === process.env.NODE_ENV) return;
        DiagnosticsInstance_js_namespaceObject.diagnostics.report("an abort listener threw while the stand-in signal was delivering the abort event; the remaining listeners still ran and the error did not escape abort(): " + (error instanceof Error ? error.message : String(error)));
    };
    Object.defineProperty(signal, 'addEventListener', {
        value: addEventListener
    });
    Object.defineProperty(signal, 'removeEventListener', {
        value: removeEventListener
    });
    Object.defineProperty(signal, 'throwIfAborted', {
        value: throwIfAborted
    });
    Object.defineProperty(signal, 'onabort', {
        get: ()=>onAbort,
        set: (handler)=>{
            const usable = 'function' == typeof handler || 'object' == typeof handler && null !== handler && 'function' == typeof handler.handleEvent;
            onAbort = usable ? handler : null;
        }
    });
    const handle = {
        signal,
        abort () {
            if (signal.aborted) return;
            signal.aborted = true;
            const firing = listeners.slice();
            listeners.length = 0;
            const event = {
                type: 'abort',
                target: signal
            };
            firing.forEach((listener)=>{
                try {
                    invoke(listener, event);
                } catch (error) {
                    reportListenerError(error);
                }
            });
            if (null !== onAbort) try {
                invoke(onAbort, event);
            } catch (error) {
                reportListenerError(error);
            }
        }
    };
    return handle;
};
exports.createAbortHandle = __webpack_exports__.createAbortHandle;
for(var __rspack_i in __webpack_exports__)if (-1 === [
    "createAbortHandle"
].indexOf(__rspack_i)) exports[__rspack_i] = __webpack_exports__[__rspack_i];
Object.defineProperty(exports, '__esModule', {
    value: true
});
