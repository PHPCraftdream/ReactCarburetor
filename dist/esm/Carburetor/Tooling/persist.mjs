const persist = (carburetor, options)=>{
    const { key, storage, coalesce } = options;
    const stored = storage.getItem(key);
    if (null !== stored) try {
        carburetor.restore(JSON.parse(stored));
    } catch (error) {
        storage.removeItem(key);
        if (options.onError) options.onError(error);
    }
    const write = ()=>{
        try {
            storage.setItem(key, JSON.stringify(carburetor.getData()));
        } catch (error) {
            if (options.onError) options.onError(error);
        }
    };
    if (!coalesce) {
        const id = carburetor.subscribe(write);
        return ()=>carburetor.unsubscribe(id);
    }
    let pending = false;
    const flush = ()=>{
        if (!pending) return;
        pending = false;
        write();
    };
    const id = carburetor.subscribe(()=>{
        if (pending) return;
        pending = true;
        queueMicrotask(flush);
    });
    return ()=>{
        carburetor.unsubscribe(id);
        flush();
    };
};
export { persist };
