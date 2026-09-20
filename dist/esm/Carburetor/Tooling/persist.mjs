import { WILDCARD_PATH } from "../Store/Paths/WildcardPath.mjs";
const persist = (carburetor, options)=>{
    const { key, storage } = options;
    const stored = storage.getItem(key);
    if (null !== stored) try {
        carburetor.restore(JSON.parse(stored));
    } catch (error) {
        storage.removeItem(key);
        if (options.onError) options.onError(error);
    }
    return carburetor.watch(new Set([
        WILDCARD_PATH
    ]), ()=>{
        storage.setItem(key, JSON.stringify(carburetor.snapshot()));
    });
};
export { persist };
