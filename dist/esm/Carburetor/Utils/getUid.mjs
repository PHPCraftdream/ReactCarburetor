const getUid = (()=>{
    let uid = 0;
    return ()=>{
        uid++;
        return 'carburetor-uid-' + uid;
    };
})();
export { getUid };
