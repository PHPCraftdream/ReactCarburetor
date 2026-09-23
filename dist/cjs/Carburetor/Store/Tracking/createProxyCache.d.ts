import { IProxyCache } from "./Models.js";
/**
 * Cache of proxies for nested branches, with explicit ownership of obsolete targets: the map holds a branch's
 * source and wrapper only while the branch is still the live value at its path. It also remembers the source object:
 * if the value behind a path has been replaced, the proxy over the old object is no longer valid and gets recreated.
 *
 * When a write replaces or deletes a branch, or reorders an array, the write proxy publishes
 * the written path to the invalidation scope shared by every proxy over the same raw object;
 * each cache sweeps the obsolete entries the next time anything consults it. A read at another
 * path is enough to release a deleted branch — no read at the old path is required, and no
 * garbage-collection timing is involved. Entries minted after an invalidation carry the newer
 * revision and survive the sweep: re-reading the written path files a fresh, valid entry.
 *
 * Sweeping is lazy by design: the cost lands on the next reader rather than the writer, and
 * the tests pin the resulting ownership down deterministically through `owns`/`size`.
 *
 * The published records are a worklist, not a history: each is retired the moment no live
 * cache needs it — every cache sharing the scope has swept through it, or none of the ones
 * that have not holds an entry it would evict. Repeated writes to the SAME path never grow this
 * worklist either: a new record for a path replaces that path's pending record instead of
 * queuing beside it (R3-06), so an idle view that never re-consults its cache still leaves the
 * ledger proportional to the distinct paths touched, not to how many times each was written.
 *
 * A fresh cache also prunes the watcher set on construction, not only on a write — a read-only
 * run that never writes still gets a retirement pass every time a new view is created (R3-07).
 * That still leans on garbage collection having actually run by then, so a view whose owner
 * knows it is done should call `release()` instead of waiting on either a write or the
 * collector: it drops the watcher slot immediately and unconditionally.
 *
 * @param target - the raw object the proxies asking for this cache front; scopes are shared
 * per raw object, so a read proxy and the write proxies over the same data observe the same
 * invalidations.
 */
export declare const createProxyCache: (target: object) => IProxyCache;
