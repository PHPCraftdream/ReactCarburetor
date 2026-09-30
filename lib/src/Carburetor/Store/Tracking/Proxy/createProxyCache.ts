import {TPath} from "@/Carburetor/Models/Paths";
import {IProxyCache} from "@/Carburetor/Store/Tracking/Models";

/** One cached branch: the path it was minted for, and the wrapper built for it. */
interface IProxyCacheEntry {
    path: TPath;
    proxy: object;
}

/**
 * Cache of proxies for nested branches, ephemeral by construction: entries live in a
 * `WeakMap` keyed by the branch's own raw object, so an entry is reachable only through the
 * object it describes and never keeps that object alive on its own.
 *
 * When a branch is removed or replaced, its old raw object stops being referenced anywhere
 * else in the data or by any live proxy; the moment that happens, the entry — and the wrapper
 * it held — becomes collectable on its own. No read-driven sweep, no write-driven invalidation
 * and no watcher bookkeeping is needed to make that true: it falls out of what a `WeakMap`
 * already guarantees.
 *
 * One cache belongs to one proxy tree — the root `createReadProxy`/`createWriteProxy` call
 * creates it, and every nested call over the same tree receives it as an argument — not to one
 * raw object. Two trees over the same data (two `read()` views, the read tree and the write
 * tree) mint independent wrappers: one recorder's read set can never be satisfied by another's
 * branch wrapper.
 *
 * A hit requires both the same raw object and the same path it is currently cached under: the
 * same object reached at a second path within one tree — the aliasing the alias ledger warns
 * about in development — mints a fresh wrapper rather than serving one path's wrapper to
 * another's read.
 */
export const createProxyCache = (nativeAliasRoot?: object): IProxyCache => new ProxyCache(nativeAliasRoot);

/** The cache itself: methods on the prototype, so one tree costs one object and its `WeakMap`. */
class ProxyCache implements IProxyCache {
    /** Associates a draft cache with the raw root whose alias index its writes invalidate.
     *
     * @param nativeAliasRoot - the draft root; absent for read-only cache trees.
     */
    constructor(public readonly nativeAliasRoot?: object) {}
    /** Entries by the raw branch object they wrap. */
    private readonly entries: WeakMap<object, IProxyCacheEntry> = new WeakMap();

    /**
     * The cached proxy for (path, source), or undefined on a miss.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw value the branch holds right now.
     */
    public get(path: TPath, source: object): object | undefined {
        const entry = this.entries.get(source);

        return entry !== undefined && entry.path === path ? entry.proxy : undefined;
    }

    /**
     * Files the wrapper built for (path, source), replacing any earlier entry for `source`.
     *
     * @param path - the full path the branch was read at.
     * @param source - the raw value the branch holds right now.
     * @param proxy - the wrapper to answer with from now on.
     */
    public set(path: TPath, source: object, proxy: object): void {
        this.entries.set(source, {path, proxy});
    }

    /**
     * Whether an entry for (path, source) stands; test introspection only.
     *
     * @param path - the path to look up.
     * @param source - the raw object the entry would have to be holding.
     */
    public owns(path: TPath, source: object): boolean {
        const entry = this.entries.get(source);

        return entry !== undefined && entry.path === path;
    }
}
