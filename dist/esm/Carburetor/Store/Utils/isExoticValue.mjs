const isExoticValue = (value)=>{
    if (null === value || 'object' != typeof value || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype !== Object.prototype && null !== prototype;
};
export { isExoticValue };
