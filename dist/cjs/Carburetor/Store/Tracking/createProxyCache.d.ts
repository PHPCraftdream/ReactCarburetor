import { IProxyCache } from "./Models.js";
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
export declare const createProxyCache: () => IProxyCache;
