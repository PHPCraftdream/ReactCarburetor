import { isTrackable } from "./Tracking.mjs";
const deepClone = (value)=>{
    if (!isTrackable(value)) return value;
    if (Array.isArray(value)) return value.map((item)=>deepClone(item));
    const source = value;
    const result = {};
    Object.keys(source).forEach((key)=>{
        result[key] = deepClone(source[key]);
    });
    return result;
};
export { deepClone };
