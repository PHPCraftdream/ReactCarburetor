import { isExoticValue } from "./isExoticValue.mjs";
const containsExoticValue = (value)=>{
    if (null === value || 'object' != typeof value) return false;
    const visited = new WeakSet();
    const walk = (candidate)=>{
        try {
            if (isExoticValue(candidate)) return true;
            if (null === candidate || 'object' != typeof candidate || visited.has(candidate)) return false;
            visited.add(candidate);
            return Reflect.ownKeys(candidate).some((key)=>{
                const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
                if (!(null == descriptor ? void 0 : descriptor.enumerable)) return false;
                if (!("value" in descriptor)) return true;
                return walk(descriptor.value);
            });
        } catch  {
            return true;
        }
    };
    return walk(value);
};
export { containsExoticValue };
