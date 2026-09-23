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
const deepClone = (value)=>{
    if (!isTrackable(value)) return value;
    if (Array.isArray(value)) return value.map((item)=>deepClone(item));
    const source = value;
    const result = Object.create(Object.getPrototypeOf(source));
    ownEnumerableKeys(source).forEach((key)=>{
        definePlainProperty(result, key, deepClone(source[key]));
    });
    return result;
};
export { deepClone };
