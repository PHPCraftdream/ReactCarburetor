import { isTrackable } from "../Tracking/isTrackable.mjs";
const detachedDescriptor = (source, key, seen, onLiveInstance)=>{
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) return;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error('detachOpaque() cannot snapshot accessor property ' + String(key) + ': select plain data fields instead.');
    descriptor.value = detach(Reflect.get(source, key), seen, onLiveInstance);
    return descriptor;
};
const detach = (value, seen, onLiveInstance)=>{
    if (null === value || 'object' != typeof value) return value;
    const known = seen.get(value);
    if (void 0 !== known) return known;
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof Map) {
        const copy = new Map();
        seen.set(value, copy);
        value.forEach((member, key)=>{
            copy.set(detach(key, seen, onLiveInstance), detach(member, seen, onLiveInstance));
        });
        return copy;
    }
    if (value instanceof Set) {
        const copy = new Set();
        seen.set(value, copy);
        value.forEach((member)=>{
            copy.add(detach(member, seen, onLiveInstance));
        });
        return copy;
    }
    if (!isTrackable(value)) {
        null == onLiveInstance || onLiveInstance(value);
        return value;
    }
    if (Array.isArray(value)) {
        const copy = [];
        seen.set(value, copy);
        Reflect.ownKeys(value).forEach((key)=>{
            if ('length' !== key) {
                const descriptor = detachedDescriptor(value, key, seen, onLiveInstance);
                if (descriptor) Object.defineProperty(copy, key, descriptor);
            }
        });
        const length = Object.getOwnPropertyDescriptor(value, 'length');
        if (length) Object.defineProperty(copy, 'length', length);
        return copy;
    }
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    seen.set(value, result);
    Reflect.ownKeys(source).forEach((key)=>{
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance);
        if (descriptor) Object.defineProperty(result, key, descriptor);
    });
    return result;
};
const detachOpaque = (value, onLiveInstance)=>detach(value, new WeakMap(), onLiveInstance);
export { detachOpaque };
