import { PATCH_ABSENT } from "../../../Models/Paths.mjs";
import { joinPath } from "../joinPath.mjs";
import { keysPath } from "../Markers/KeysMarker.mjs";
import { WILDCARD_PATH } from "../WildcardPath.mjs";
import { isTrackable } from "../../Tracking/isTrackable.mjs";
import { deepClone } from "../../Utils/deepClone.mjs";
import { DIFF_PATH_THRESHOLD } from "./DiffThreshold.mjs";
import { hasSymbolDifference } from "./hasSymbolDifference.mjs";
import { sameKind } from "./sameKind.mjs";
class DiffOverflow extends Error {
}
const patchValue = (value)=>isTrackable(value) ? deepClone(value) : value;
const add = (into, path)=>{
    into.add(path);
    if (into.size > DIFF_PATH_THRESHOLD) throw new DiffOverflow();
};
const addPatch = (onPatch, segments, previous, next)=>{
    null == onPatch || onPatch({
        segments,
        previous: patchValue(previous),
        next: patchValue(next)
    });
};
const walkContainer = (oldValue, newValue, path, segments, into, onPatch)=>{
    if (hasSymbolDifference(oldValue, newValue)) {
        add(into, path || WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);
        return;
    }
    if (Array.isArray(oldValue) && oldValue.length !== newValue.length) {
        add(into, joinPath(path, 'length'));
        addPatch(onPatch, [
            ...segments,
            'length'
        ], oldValue.length, newValue.length);
    }
    const oldKeys = Object.keys(oldValue);
    const newKeys = Object.keys(newValue);
    const seen = new Set();
    let keysChanged = false;
    for (const key of oldKeys){
        seen.add(key);
        if (!Object.prototype.hasOwnProperty.call(newValue, key)) {
            keysChanged = true;
            add(into, joinPath(path, key));
            addPatch(onPatch, [
                ...segments,
                key
            ], oldValue[key], PATCH_ABSENT);
            continue;
        }
        walk(oldValue[key], newValue[key], joinPath(path, key), [
            ...segments,
            key
        ], into, onPatch);
    }
    for (const key of newKeys)if (!seen.has(key)) {
        keysChanged = true;
        add(into, joinPath(path, key));
        addPatch(onPatch, [
            ...segments,
            key
        ], PATCH_ABSENT, newValue[key]);
    }
    if (keysChanged) add(into, keysPath(path));
};
const walk = (oldValue, newValue, path, segments, into, onPatch)=>{
    if (Object.is(oldValue, newValue)) return;
    if (!isTrackable(oldValue) || !isTrackable(newValue)) {
        add(into, path || WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);
        return;
    }
    if (!sameKind(oldValue, newValue)) {
        add(into, path || WILDCARD_PATH);
        addPatch(onPatch, segments, oldValue, newValue);
        return;
    }
    walkContainer(oldValue, newValue, path, segments, into, onPatch);
};
const diffPaths = (oldValue, newValue, basePath = '', baseSegments = [], onPatch)=>{
    const changed = new Set();
    try {
        walk(oldValue, newValue, basePath, baseSegments, changed, onPatch);
    } catch (error) {
        if (!(error instanceof DiffOverflow)) throw error;
        changed.clear();
        changed.add(basePath || WILDCARD_PATH);
        addPatch(onPatch, baseSegments, oldValue, newValue);
    }
    return changed;
};
export { diffPaths };
