const createProxyCache = ()=>{
    const entries = new WeakMap();
    const cache = (path, source, create)=>{
        const entry = entries.get(source);
        if (void 0 !== entry && entry.path === path) return entry.proxy;
        const proxy = create();
        entries.set(source, {
            path,
            proxy
        });
        return proxy;
    };
    cache.owns = (path, source)=>{
        const entry = entries.get(source);
        return void 0 !== entry && entry.path === path;
    };
    return cache;
};
export { createProxyCache };
