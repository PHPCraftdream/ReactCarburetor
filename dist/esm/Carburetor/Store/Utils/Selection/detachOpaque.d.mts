/** The per-instance report a caller can wire in: fired for each live class instance handed over. */
type TReportLiveInstance = (instance: object) => void;
/** Optional stricter array policy used by class connection selections. */
type TArraySubclassGuard = (instance: object) => never;
/**
 * Recursively detaches plain objects, arrays, Maps, Sets and Dates.
 * Own string and symbol data descriptors are preserved; accessors are rejected without invocation.
 *
 * A null-prototype dictionary stays null-prototype. An accessor cannot produce a detached
 * snapshot because its value may remain connected to mutable source state.
 *
 * That is the boundary `deepClone` deliberately does not provide: the store's own
 * snapshot/restore round trip carries opaque values by reference, while a React snapshot handed to
 * `useSyncExternalStore` must stay immutable under in-place mutation.
 *
 * A class instance — anything else with a prototype of its own, including a Map/Set/Date
 * subclass — has no generic safe copy and passes through live, at the root and nested alike;
 * `onLiveInstance` lets the caller hear about each one. A recognized tracked read proxy and
 * its raw branch share one detached copy, including when the raw branch is visited first via
 * a Map; only the original source key still misses lookups into the detached Map.
 *
 * @param value - the value to detach
 * @param onLiveInstance - optional report fired for each live class instance the copy has to hand
 * over, at any depth
 * @param onArraySubclass - optional rejection policy for class selections
 * @returns the detached copy
 */
export declare const detachOpaque: <T>(value: T, onLiveInstance?: TReportLiveInstance, onArraySubclass?: TArraySubclassGuard) => T;
export {};
