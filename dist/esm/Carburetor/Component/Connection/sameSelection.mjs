import { isPlainObject } from "./isPlainObject.mjs";
import { ownEnumerableKeys } from "./ownEnumerableKeys.mjs";
const sameSelection = (snapshot, next)=>{
    if (Object.is(snapshot, next)) return true;
    const snapshotIsArray = Array.isArray(snapshot);
    const nextIsArray = Array.isArray(next);
    if (snapshotIsArray || nextIsArray) {
        if (!snapshotIsArray || !nextIsArray) return false;
        const previousMembers = snapshot;
        const freshMembers = next;
        return previousMembers.length === freshMembers.length && previousMembers.every((member, index)=>Object.is(member, freshMembers[index]));
    }
    if (!isPlainObject(snapshot) || !isPlainObject(next)) return false;
    const previousKeys = ownEnumerableKeys(snapshot);
    const freshKeys = ownEnumerableKeys(next);
    if (previousKeys.length !== freshKeys.length) return false;
    const previousMembers = snapshot;
    const freshMembers = next;
    return previousKeys.every((key)=>Object.prototype.hasOwnProperty.call(freshMembers, key) && Object.is(previousMembers[key], freshMembers[key]));
};
export { sameSelection };
