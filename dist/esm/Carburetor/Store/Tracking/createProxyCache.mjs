const createProxyCache = ()=>{
    const entries = new Map();
    return (path, source, create)=>{
        const entry = entries.get(path);
        if (entry && entry.source === source) return entry.proxy;
        const proxy = create();
        entries.set(path, {
            source,
            proxy
        });
        return proxy;
    };
};
export { createProxyCache };
