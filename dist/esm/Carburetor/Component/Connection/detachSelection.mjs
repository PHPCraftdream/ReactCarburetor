import { isPlainObject } from "./isPlainObject.mjs";
import { ownEnumerableKeys } from "./ownEnumerableKeys.mjs";
const detachDeep = (value, seen)=>{
    if ('object' != typeof value || null === value) return value;
    if (seen.has(value)) return seen.get(value);
    const isArray = Array.isArray(value);
    if (!isArray && !isPlainObject(value)) return value;
    const target = isArray ? [] : {};
    seen.set(value, target);
    const source = value;
    ownEnumerableKeys(value).forEach((key)=>{
        target[key] = detachDeep(source[key], seen);
    });
    return target;
};
const detachSelection = (value)=>detachDeep(value, new WeakMap());
export { detachSelection };
