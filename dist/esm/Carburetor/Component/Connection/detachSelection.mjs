import { isPlainObject } from "./isPlainObject.mjs";
const detachSelection = (value)=>{
    if (Array.isArray(value)) return Array.from(value);
    if (isPlainObject(value)) return {
        ...value
    };
    return value;
};
export { detachSelection };
