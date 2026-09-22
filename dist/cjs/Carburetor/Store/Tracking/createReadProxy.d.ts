import { TPath, TPathRecorder, TAliasLedger } from "../../Models/Paths.js";
/**
 * Read proxy: every field access is recorded as a path. Writing through it is forbidden —
 * `set`, `deleteProperty` and `defineProperty` all throw — and `getOwnPropertyDescriptor`
 * wraps object values like `get` does, so no trap hands out raw state.
 *
 * Structural changes are refused the same way, at every level of the read tree:
 * `setPrototypeOf` (prototype changes) and `preventExtensions` (extension changes) both
 * throw, so neither a root view nor any nested branch behind it can reshape the backing
 * object. Introspection stays truthful: no getPrototypeOf or isExtensible trap answers
 * them, so a view keeps reporting exactly what the raw data is.
 *
 * Plain objects and arrays only: a Map, Date, Set or class instance passes through unwrapped,
 * so a mutating method called on one of those sits outside this guard.
 *
 * Frozen data is refused, not wrapped. For a non-configurable, non-writable property the
 * engine accepts no proxy answer but the raw value — from `get` and `getOwnPropertyDescriptor`
 * alike — so nothing inside a frozen branch can be wrapped by spec, and handing out the raw
 * object would be the untracked, unguarded leak this view exists to prevent. Development
 * throws with the path named; production hands out the raw branch, still recorded as a branch
 * read, the same degrade-and-mark policy the write proxy applies to Maps.
 *
 * Two contracts the recording relies on. Accessors run against the proxy — it is handed to
 * `Reflect.get` as the receiver — so the reads a getter makes internally are tracked like any
 * other; a getter that returns a branch is an alias by another name and is not supported. And
 * the data is a tree, one object at one path: a second path to a live object is reported in
 * development through the alias ledger, which production compiles out.
 *
 * @param target - the raw state this proxy fronts, held by reference: nothing copies it, so
 * every trap answers from the object as it is now
 * @param record - where each touched path is reported, supplied by read(); a branch read
 * reports the branch marker, not every path inside it
 * @param basePath - the dotted path this root answers for; the default '' is the store root,
 * and its emptiness is what makes ownKeys record the wildcard
 * @param aliases - development-only: notes each branch object under its path so a second
 * path to the same object is reported; production hands in undefined
 */
export declare const createReadProxy: <T extends object>(target: T, record: TPathRecorder, basePath?: TPath, aliases?: TAliasLedger) => T;
