const isTrackable = (value)=>{
    if (null === value || 'object' != typeof value) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === Array.prototype || null === prototype;
};
export { isTrackable };
