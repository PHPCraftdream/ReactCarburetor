const shallowEqual = (left, right)=>{
    if (Object.is(left, right)) return true;
    if ('object' != typeof left || 'object' != typeof right || null === left || null === right) return false;
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false;
        for(let i = 0; i < left.length; i++)if (!Object.is(left[i], right[i])) return false;
        return true;
    }
    const leftRecord = left;
    const rightRecord = right;
    const leftKeys = Object.keys(leftRecord);
    if (leftKeys.length !== Object.keys(rightRecord).length) return false;
    return leftKeys.every((key)=>key in rightRecord && Object.is(leftRecord[key], rightRecord[key]));
};
export { shallowEqual };
