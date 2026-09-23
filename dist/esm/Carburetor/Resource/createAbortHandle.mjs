import { diagnostics } from "../Store/Diagnostics/DiagnosticsInstance.mjs";
let reported = false;
const createAbortHandle = ()=>{
    if ('function' == typeof AbortController) return new AbortController();
    if ("u" > typeof process && 'production' !== process.env.NODE_ENV && !reported) {
        reported = true;
        diagnostics.report("this runtime has no AbortController (Node added one in 14.17.0; the advertised floor is 14.6.0), so resource requests degrade to unabortable: the loader is handed a signal that never fires, and abort() can only keep a late answer from being stored, not stop the request itself.");
    }
    const handle = {
        signal: {
            aborted: false
        },
        abort () {
            handle.signal.aborted = true;
        }
    };
    return handle;
};
export { createAbortHandle };
