import { isTrackable } from "../Tracking/isTrackable.mjs";
const ownEnumerableKeys = (source)=>Reflect.ownKeys(source).filter((key)=>Object.prototype.propertyIsEnumerable.call(source, key));
const definePlainProperty = (target, key, value)=>{
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    });
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
        value.forEach((item, index)=>{
            copy[index] = detach(item, seen, onLiveInstance);
        });
        copy.length = value.length;
        return copy;
    }
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    seen.set(value, result);
    ownEnumerableKeys(source).forEach((key)=>{
        definePlainProperty(result, key, detach(source[key], seen, onLiveInstance));
    });
    return result;
};
const detachOpaque = (value, onLiveInstance)=>detach(value, new WeakMap(), onLiveInstance);
export { detachOpaque };
