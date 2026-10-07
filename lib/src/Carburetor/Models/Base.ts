export interface IDict<T> {
    [id: string]: T;
}

/** Subscriber callback: takes no arguments, data is read back through `read`. */
export type TSubscriber = () => void;

/** A component update queued by a scheduler. */
export type TUpdater = () => void;

/** Undoes what an effect did; runs before the effect re-runs and on unmount. */
export type TEffectCleanup = () => void;

/** Body of a component effect. It may return its own cleanup. */
export type TEffect = () => TEffectCleanup | void;

/** Values an effect depends on; compared element by element with Object.is. */
export type TEffectDeps = ReadonlyArray<unknown>;

/** Removes a subscription established outside React. */
export type TDisposer = () => void;

/** Timer handle: a number in the browser, a Timeout in Node — inferred from setTimeout itself. */
export type TTimerHandle = ReturnType<typeof setTimeout> | undefined;

/**
 * Deeply immutable view of data, including detached selection results. Selection projections are
 * borrowed from internal comparison caches: copy plain data before editing it. Standard Map/Set
 * mutators and Date setters are excluded from the type surface; this is compile-time only, not a
 * runtime guard. Native values and class instances are not frozen, so JavaScript or unsafe casts
 * can still mutate them; those escapes are unsupported.
 */
export type TReadonly<T> =
    T extends (...args: never[]) => unknown ? T :
    T extends ReadonlyMap<infer K, infer V> ? ReadonlyMap<TReadonly<K>, TReadonly<V>> :
    T extends ReadonlySet<infer V> ? ReadonlySet<TReadonly<V>> :
    T extends Date ? TReadonly<Omit<T, Extract<keyof Date, `set${string}`>>> :
    T extends ReadonlyArray<unknown> ? {readonly [TKey in keyof T]: TReadonly<T[TKey]>} :
    T extends object ? {readonly [TKey in keyof T]: TReadonly<T[TKey]>} :
    T;
