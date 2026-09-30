import { isTrackable } from "../Tracking/isTrackable.mjs";
const deepClone = (value)=>{
    if (!isTrackable(value)) return value;
    if (Array.isArray(value)) {
        const length = value.length;
        const result = [];
        result.length = length;
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Array.prototype) Object.setPrototypeOf(result, prototype);
        if (length <= 4096) {
            for(let index = 0; index < length; index++)if (Object.prototype.hasOwnProperty.call(value, index)) result[index] = deepClone(value[index]);
        } else for (const key of Object.keys(value)){
            const index = Number(key);
            if (Number.isInteger(index) && index >= 0 && index < length && String(index) === key) result[index] = deepClone(value[index]);
        }
        return result;
    }
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    const keys = Object.keys(source);
    for(let i = 0; i < keys.length; i++){
        const key = keys[i];
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
