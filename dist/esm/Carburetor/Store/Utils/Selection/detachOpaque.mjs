import { isTrackable } from "../../Tracking/isTrackable.mjs";
import { liveViews } from "../../Tracking/liveViews.mjs";
const detachedDescriptor = (source, key, seen, onLiveInstance, onArraySubclass, descriptorSource = source)=>{
    const descriptor = Object.getOwnPropertyDescriptor(descriptorSource, key);
    if (!descriptor) return;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) throw new Error((void 0 === onArraySubclass ? 'detachOpaque()' : 'detachSelection()') + ' cannot snapshot accessor property ' + String(key) + ': select plain data fields instead.');
    descriptor.value = detach(Reflect.get(source, key), seen, onLiveInstance, onArraySubclass);
    return descriptor;
};
const copyNativeFields = (source, copy, seen, onLiveInstance, onArraySubclass)=>{
    const keys = Reflect.ownKeys(source);
    for(let index = 0; index < keys.length; index++){
        const key = keys[index];
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance, onArraySubclass);
        if (descriptor) Object.defineProperty(copy, key, descriptor);
    }
};
const detach = (value, seen, onLiveInstance, onArraySubclass)=>{
    if (null === value || 'object' != typeof value) return value;
    const target = liveViews.readTarget(value);
    const known = seen.get(target ?? value);
    if (void 0 !== known) {
        if (void 0 !== target && !seen.has(value)) {
            seen.set(value, known);
            Reflect.ownKeys(value).forEach((key)=>{
                if (!Array.isArray(value) || 'length' !== key) detachedDescriptor(value, key, seen, onLiveInstance, onArraySubclass, target);
            });
        }
        return known;
    }
    const native = target ?? value;
    if (native instanceof Date && Object.getPrototypeOf(native) === Date.prototype) {
        const copy = new Date(Date.prototype.getTime.call(native));
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);
        return copy;
    }
    if (native instanceof Map && Object.getPrototypeOf(native) === Map.prototype) {
        const copy = new Map();
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        Map.prototype.forEach.call(native, (member, key)=>{
            copy.set(detach(key, seen, onLiveInstance, onArraySubclass), detach(member, seen, onLiveInstance, onArraySubclass));
        });
        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);
        return copy;
    }
    if (native instanceof Set && Object.getPrototypeOf(native) === Set.prototype) {
        const copy = new Set();
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        Set.prototype.forEach.call(native, (member)=>{
            copy.add(detach(member, seen, onLiveInstance, onArraySubclass));
        });
        copyNativeFields(native, copy, seen, onLiveInstance, onArraySubclass);
        return copy;
    }
    if (Array.isArray(value)) {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Array.prototype && prototype !== Object.prototype && null !== prototype) {
            if (void 0 !== onArraySubclass) onArraySubclass(value);
            null == onLiveInstance || onLiveInstance(value);
            return value;
        }
        const copy = prototype === Array.prototype ? [] : Object.setPrototypeOf([], prototype);
        seen.set(value, copy);
        if (void 0 !== target) seen.set(target, copy);
        Reflect.ownKeys(value).forEach((key)=>{
            if ('length' !== key) {
                const descriptor = detachedDescriptor(value, key, seen, onLiveInstance, onArraySubclass, target);
                if (descriptor) Object.defineProperty(copy, key, descriptor);
            }
        });
        const length = Object.getOwnPropertyDescriptor(value, 'length');
        if (length) Object.defineProperty(copy, 'length', length);
        return copy;
    }
    if (!isTrackable(value)) {
        null == onLiveInstance || onLiveInstance(value);
        return value;
    }
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    seen.set(value, result);
    if (void 0 !== target) seen.set(target, result);
    Reflect.ownKeys(source).forEach((key)=>{
        const descriptor = detachedDescriptor(source, key, seen, onLiveInstance, onArraySubclass, target);
        if (descriptor) Object.defineProperty(result, key, descriptor);
    });
    return result;
};
const detachOpaque = (value, onLiveInstance, onArraySubclass)=>detach(value, new WeakMap(), onLiveInstance, onArraySubclass);
export { detachOpaque };
