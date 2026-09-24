import { isPlainObject } from "./isPlainObject.mjs";
const isExotic = (value)=>'object' == typeof value && null !== value && !Array.isArray(value) && !isPlainObject(value);
const sameKeyedContent = (snapshot, next, previousToFresh, freshToPrevious)=>{
    const previousKeys = Reflect.ownKeys(snapshot);
    const freshKeys = Reflect.ownKeys(next);
    if (previousKeys.length !== freshKeys.length) return false;
    return previousKeys.every((key)=>{
        const previousDescriptor = Object.getOwnPropertyDescriptor(snapshot, key);
        const freshDescriptor = Object.getOwnPropertyDescriptor(next, key);
        if (void 0 === previousDescriptor || void 0 === freshDescriptor) return false;
        if (!Object.prototype.hasOwnProperty.call(previousDescriptor, 'value') || !Object.prototype.hasOwnProperty.call(freshDescriptor, 'value')) throw new Error('sameSelection() cannot compare accessor property ' + String(key) + ': select plain data fields instead.');
        if (previousDescriptor.enumerable !== freshDescriptor.enumerable || previousDescriptor.configurable !== freshDescriptor.configurable || previousDescriptor.writable !== freshDescriptor.writable) return false;
        return sameValue(Reflect.get(snapshot, key), Reflect.get(next, key), previousToFresh, freshToPrevious);
    });
};
const sameValue = (a, b, previousToFresh, freshToPrevious)=>{
    if (isExotic(a) || isExotic(b)) return false;
    if (Object.is(a, b)) return true;
    if ('object' != typeof a || null === a || 'object' != typeof b || null === b) return false;
    const mapped = previousToFresh.get(a);
    if (void 0 !== mapped) return mapped === b;
    if (void 0 !== freshToPrevious.get(b)) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
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
