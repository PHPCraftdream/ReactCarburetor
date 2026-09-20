export const getUid = (() => {
    let uid = 0;
    return (): string => {
        uid++;

        return 'carburetor-uid-' + uid;
    };
})();
