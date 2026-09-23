import { isPlainObject } from "./isPlainObject.mjs";
import { ownEnumerableKeys } from "./ownEnumerableKeys.mjs";
const sameKeyedContent = (snapshot, next, seen)=>{
    const previousKeys = ownEnumerableKeys(snapshot);
    const freshKeys = ownEnumerableKeys(next);
    if (previousKeys.length !== freshKeys.length) return false;
    const previousMembers = snapshot;
    const freshMembers = next;
    return previousKeys.every((key)=>Object.prototype.hasOwnProperty.call(freshMembers, key) && sameValue(previousMembers[key], freshMembers[key], seen));
};
const sameValue = (a, b, seen)=>{
    if (Object.is(a, b)) return true;
    if ('object' != typeof a || null === a || 'object' != typeof b || null === b) return false;
    if (seen.get(a) === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        seen.set(a, b);
        return sameKeyedContent(a, b, seen);
    }
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    seen.set(a, b);
    return sameKeyedContent(a, b, seen);
};
const sameSelection = (snapshot, next)=>sameValue(snapshot, next, new WeakMap());
export { sameSelection };
