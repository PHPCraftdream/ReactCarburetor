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
 * Deeply immutable view of the data. Data read through a carburetor is read-only:
 * the proxy throws on a write at runtime, and this type makes the compiler say so first.
 */
export type TReadonly<T> =
    T extends (...args: never[]) => unknown ? T :
    T extends ReadonlyArray<infer TItem> ? ReadonlyArray<TReadonly<TItem>> :
    T extends object ? {readonly [TKey in keyof T]: TReadonly<T[TKey]>} :
    T;
