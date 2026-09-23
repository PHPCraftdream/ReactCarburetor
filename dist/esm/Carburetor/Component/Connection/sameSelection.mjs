import { isPlainObject } from "./isPlainObject.mjs";
import { ownEnumerableKeys } from "./ownEnumerableKeys.mjs";
const isExotic = (value)=>'object' == typeof value && null !== value && !Array.isArray(value) && !isPlainObject(value);
const sameKeyedContent = (snapshot, next, previousToFresh, freshToPrevious)=>{
    const previousKeys = ownEnumerableKeys(snapshot);
    const freshKeys = ownEnumerableKeys(next);
    if (previousKeys.length !== freshKeys.length) return false;
    const previousMembers = snapshot;
    const freshMembers = next;
    return previousKeys.every((key)=>Object.prototype.hasOwnProperty.call(freshMembers, key) && sameValue(previousMembers[key], freshMembers[key], previousToFresh, freshToPrevious));
};
const sameValue = (a, b, previousToFresh, freshToPrevious)=>{
    if (isExotic(a) || isExotic(b)) return false;
    if (Object.is(a, b)) return true;
    if ('object' != typeof a || null === a || 'object' != typeof b || null === b) return false;
    const mapped = previousToFresh.get(a);
    if (void 0 !== mapped) return mapped === b;
    if (void 0 !== freshToPrevious.get(b)) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        previousToFresh.set(a, b);
        freshToPrevious.set(b, a);
        return sameKeyedContent(a, b, previousToFresh, freshToPrevious);
    }
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    previousToFresh.set(a, b);
    freshToPrevious.set(b, a);
    return sameKeyedContent(a, b, previousToFresh, freshToPrevious);
};
const sameSelection = (snapshot, next)=>sameValue(snapshot, next, new WeakMap(), new WeakMap());
export { sameSelection };
