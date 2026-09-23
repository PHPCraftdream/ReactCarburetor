import { isPlainObject } from "./isPlainObject.mjs";
import { ownEnumerableKeys } from "./ownEnumerableKeys.mjs";
const definePlainProperty = (target, key, value)=>{
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    });
};
const detachDeep = (value, seen)=>{
    if ('object' != typeof value || null === value) return value;
    if (seen.has(value)) return seen.get(value);
    const isArray = Array.isArray(value);
    if (!isArray && !isPlainObject(value)) return value;
    const target = isArray ? [] : Object.create(Object.getPrototypeOf(value));
    seen.set(value, target);
    const source = value;
    ownEnumerableKeys(value).forEach((key)=>{
        definePlainProperty(target, key, detachDeep(source[key], seen));
    });
    if (isArray) target.length = value.length;
    return target;
};
const detachSelection = (value)=>detachDeep(value, new WeakMap());
export { detachSelection };
