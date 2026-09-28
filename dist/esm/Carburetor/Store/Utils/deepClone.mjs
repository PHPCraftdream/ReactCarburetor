import { isTrackable } from "../Tracking/isTrackable.mjs";
const deepClone = (value)=>{
    if (!isTrackable(value)) return value;
    if (Array.isArray(value)) {
        const length = value.length;
        const result = [];
        result.length = length;
        for(let index = 0; index < length; index++)if (index in value) result[index] = deepClone(value[index]);
        return result;
    }
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    const keys = Reflect.ownKeys(source);
    for(let i = 0; i < keys.length; i++){
        const key = keys[i];
        if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
        const cloned = deepClone(source[key]);
        if ('__proto__' === key) Object.defineProperty(result, key, {
            value: cloned,
            writable: true,
            enumerable: true,
            configurable: true
        });
        else result[key] = cloned;
    }
    return result;
};
export { deepClone };
