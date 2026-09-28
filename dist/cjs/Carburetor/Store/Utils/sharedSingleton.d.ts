/**
 * Reads a value shared by every copy of the library in this process, creating it with `create`
 * on first use and reusing it after — including across a CJS/ESM split or a duplicated install.
 *
 * Without this, each copy gets its own `CarburetorContext`/`updateBatch`/`updateWave`, silently
 * breaking `contextType`, `transaction()` batching across stores, and computed settlement across
 * copies. In development, a call whose copy or `react` disagrees with the one that created the
 * entry reports once — exactly what a duplicated install or a split module format produces.
 *
 * @param name - the value's identity; keys a dedicated `globalThis` slot
 * @param create - builds the value; runs only for the copy that claims the slot first
 * @param react - a stable identity from this copy's React (e.g. `React.Component`, not the
 * `React` namespace itself — a namespace object differs across require/import of one install),
 * compared against the creator's when supplied
 */
export declare const sharedSingleton: <T>(name: string, create: () => T, react?: unknown) => T;
