const persist = (carburetor, options)=>{
    const { key, storage } = options;
    const stored = storage.getItem(key);
    if (null !== stored) try {
        carburetor.restore(JSON.parse(stored));
    } catch (error) {
        storage.removeItem(key);
        if (options.onError) options.onError(error);
    }
    return carburetor.watch(()=>{
        try {
            storage.setItem(key, JSON.stringify(carburetor.getData()));
        } catch (error) {
            if (options.onError) options.onError(error);
        }
    });
};
export { persist };
