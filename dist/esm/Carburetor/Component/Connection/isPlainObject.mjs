const isPlainObject = (value)=>{
    if ('object' != typeof value || null === value || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return null === prototype || prototype === Object.prototype;
};
export { isPlainObject };
