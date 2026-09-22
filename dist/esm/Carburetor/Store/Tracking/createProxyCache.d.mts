import { IProxyCache } from "./Models.mjs";
/**
 * Cache of proxies for nested branches, with explicit ownership of obsolete targets: the map holds a branch's
 * source and wrapper only while the branch is still the live value at its path. It also remembers the source object:
 * if the value behind a path has been replaced, the proxy over the old object is no longer valid and gets recreated.
 *
 * When a write replaces or deletes a branch, or reorders an array, the write proxy publishes
 * the written path to the invalidation scope shared by every proxy over the same raw object;
 * each cache over that object sweeps the obsolete entries the next time anything consults it.
 * A read at another path is enough to release a deleted branch — no read at the old path is
 * required, and no garbage-collection timing is involved. Entries minted after an invalidation
 * carry the newer revision and survive the sweep: re-reading the written path files a fresh,
 * valid entry.
 *
 * Sweeping is lazy by design: the cost lands on the next reader rather than the writer, and
 * the tests pin the resulting ownership down deterministically through `owns`/`size`.
 *
 * @param target - the raw object the proxies asking for this cache front; scopes are shared
 * per raw object, so a read proxy and the write proxies over the same data observe the same
 * invalidations.
 */
export declare const createProxyCache: (target: object) => IProxyCache;
