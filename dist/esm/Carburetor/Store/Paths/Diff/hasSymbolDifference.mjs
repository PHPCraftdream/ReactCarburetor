const hasSymbolDifference = (a, b)=>{
    const keys = new Set([
        ...Object.getOwnPropertySymbols(a),
        ...Object.getOwnPropertySymbols(b)
    ]);
    for (const key of keys)if (!Object.is(a[key], b[key])) return true;
    return false;
};
export { hasSymbolDifference };
