import { isTrackable } from "../Tracking/isTrackable.mjs";
const definePlainProperty = (target, key, value)=>{
    Object.defineProperty(target, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true
    });
};
const deepClone = (value)=>{
    if (!isTrackable(value)) return value;
    if (Array.isArray(value)) return value.map((item)=>deepClone(item));
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    Object.keys(source).forEach((key)=>{
        definePlainProperty(result, key, deepClone(source[key]));
    });
    return result;
};
export { deepClone };
