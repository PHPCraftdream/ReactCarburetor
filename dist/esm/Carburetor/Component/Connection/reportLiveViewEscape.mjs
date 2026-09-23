import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { liveViews } from "../../Store/Tracking/liveViews.mjs";
import { isPlainObject } from "./isPlainObject.mjs";
const reportLiveViewEscape = (next)=>{
    const guidance = "A child reading it in its own render records nothing, so no subscription covers what it sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays built from them.";
    if (liveViews.has(next)) {
        diagnostics.report('a connectSelection() snapshot handed a child a live store view as its whole value. ' + guidance);
        return true;
    }
    if (Array.isArray(next)) {
        const index = next.findIndex((member)=>liveViews.has(member));
        if (-1 !== index) {
            diagnostics.report('a connectSelection() snapshot handed a child a live store view as array member ' + index + '. ' + guidance);
            return true;
        }
        return false;
    }
    if (isPlainObject(next)) {
        const members = next;
        const key = Object.keys(members).find((memberKey)=>liveViews.has(members[memberKey]));
        if (void 0 !== key) {
            diagnostics.report('a connectSelection() snapshot handed a child a live store view as member "' + key + '". ' + guidance);
            return true;
        }
    }
    return false;
};
export { reportLiveViewEscape };
