import { diagnostics } from "../../Store/Diagnostics/DiagnosticsInstance.mjs";
import { liveViews } from "../../Store/Tracking/liveViews.mjs";
import { isPlainObject } from "./isPlainObject.mjs";
const describeSegment = (segment)=>'symbol' == typeof segment ? '[' + segment.toString() + ']' : segment;
const findLiveView = (value, visited, path)=>{
    if (liveViews.has(value)) return path;
    if ('object' != typeof value || null === value) return;
    if (!Array.isArray(value) && !isPlainObject(value)) return;
    if (visited.has(value)) return;
    visited.add(value);
    for (const key of Reflect.ownKeys(value)){
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (void 0 === descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) continue;
        const found = findLiveView(Reflect.get(value, key), visited, [
            ...path,
            key
        ]);
        if (void 0 !== found) return found;
    }
};
const reportLiveViewEscape = (next)=>{
    const location = findLiveView(next, new Set(), []);
    if (void 0 === location) return false;
    const where = 0 === location.length ? 'as its whole value' : 'at "' + location.map(describeSegment).join('.') + '"';
    diagnostics.report('a connectSelection() snapshot handed a child a live store view ' + where + ". A child reading it in its own render records nothing, so no subscription covers what it sees and it never hears about changes. Select plain values — primitives, or plain objects and arrays built from them.");
    return true;
};
export { reportLiveViewEscape };
