const persist = (carburetor, options)=>{
    const { key, storage, coalesce } = options;
    let stored;
    try {
        stored = storage.getItem(key);
    } catch (error) {
        if (!options.onError) throw error;
        options.onError(error);
        stored = null;
    }
    if (null !== stored) try {
        carburetor.restore(JSON.parse(stored));
    } catch (error) {
        var _options_onError;
        null == (_options_onError = options.onError) || _options_onError.call(options, error);
        try {
            storage.removeItem(key);
        } catch (removeError) {
            if (options.onError) options.onError(removeError);
            else throw removeError;
        }
    }
    const write = ()=>{
        try {
            storage.setItem(key, carburetor.serialize());
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
