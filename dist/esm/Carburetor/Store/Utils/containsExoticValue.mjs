import { isExoticValue } from "./isExoticValue.mjs";
const containsExoticValue = (value)=>{
    if (null === value || 'object' != typeof value) return false;
    const visited = new WeakSet();
    const walk = (candidate)=>{
        if (isExoticValue(candidate)) return true;
        if (null === candidate || 'object' != typeof candidate || visited.has(candidate)) return false;
        visited.add(candidate);
        return Object.values(candidate).some((member)=>walk(member));
    };
    return walk(value);
};
export { containsExoticValue };
