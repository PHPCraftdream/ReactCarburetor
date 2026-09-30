const createProxyCache = ()=>new ProxyCache();
class ProxyCache {
    entries = new WeakMap();
    get(path, source) {
        const entry = this.entries.get(source);
        return void 0 !== entry && entry.path === path ? entry.proxy : void 0;
    }
    set(path, source, proxy) {
        this.entries.set(source, {
            path,
            proxy
        });
    }
    owns(path, source) {
        const entry = this.entries.get(source);
        return void 0 !== entry && entry.path === path;
    }
}
export { createProxyCache };
