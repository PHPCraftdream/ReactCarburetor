import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
let reported = false;
const createAbortHandle = ()=>{
    if ('function' == typeof AbortController) return new AbortController();
    if ("u" > typeof process && 'production' !== process.env.NODE_ENV && !reported) {
        reported = true;
        diagnostics.report("this runtime has no AbortController (Node added one in 14.17.0; the advertised floor is 14.6.0), so cancellation degrades: the stand-in signal honors abort(), fires the abort listeners a loader registered, and still keeps a late answer from being stored, but it is not a native AbortSignal, so an API that demands native signal identity (fetch, for one) rejects it and nothing interrupts the request itself.");
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
        diagnostics.report("an abort listener threw while the stand-in signal was delivering the abort event; the remaining listeners still ran and the error did not escape abort(): " + (error instanceof Error ? error.message : String(error)));
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
export { createAbortHandle };
