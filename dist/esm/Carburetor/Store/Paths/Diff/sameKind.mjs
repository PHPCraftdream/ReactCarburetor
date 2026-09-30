const sameKind = (a, b)=>{
    const arrays = Array.isArray(a);
    return arrays === Array.isArray(b) && Object.getPrototypeOf(a) === Object.getPrototypeOf(b);
};
export { sameKind };
