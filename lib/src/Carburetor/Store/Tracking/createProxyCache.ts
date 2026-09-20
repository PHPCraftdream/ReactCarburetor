import {TPath} from "../../Models/Paths";

interface IProxyCacheEntry {
    source: object;
    proxy: object;
}

/**
 * Cache of proxies for nested branches. It also remembers the source object: if the value
 * behind a path has been replaced, the proxy over the old object is no longer valid and
 * gets recreated.
 */
export const createProxyCache = () => {
    const entries: Map<TPath, IProxyCacheEntry> = new Map<TPath, IProxyCacheEntry>();

    return (path: TPath, source: object, create: () => object): object => {
        const entry = entries.get(path);

        if (entry && entry.source === source) {
            return entry.proxy;
        }

        const proxy = create();
        entries.set(path, {source, proxy});

        return proxy;
    };
};
