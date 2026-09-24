import { isPlainObject } from "./isPlainObject.mjs";
const detachedDescriptor = (source, key, seen)=>{
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (void 0 === descriptor) return;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('detachSelection() cannot snapshot accessor property ' + String(key) + ': select plain data fields instead.');
    descriptor.value = detachDeep(Reflect.get(source, key), seen);
    return descriptor;
};
const detachDeep = (value, seen)=>{
    if ('object' != typeof value || null === value) return value;
    if (seen.has(value)) return seen.get(value);
    const isArray = Array.isArray(value);
    if (!isArray && !isPlainObject(value)) return value;
    const target = isArray ? Object.setPrototypeOf([], Object.getPrototypeOf(value)) : Object.create(Object.getPrototypeOf(value));
    seen.set(value, target);
    const source = value;
    Reflect.ownKeys(value).forEach((key)=>{
        if (isArray && 'length' === key) return;
        const descriptor = detachedDescriptor(source, key, seen);
        if (void 0 !== descriptor) Object.defineProperty(target, key, descriptor);
    });
    if (isArray) {
        const length = Object.getOwnPropertyDescriptor(value, 'length');
        if (void 0 !== length) Object.defineProperty(target, 'length', length);
    }
    return target;
};
const detachSelection = (value)=>detachDeep(value, new WeakMap());
export { detachSelection };
