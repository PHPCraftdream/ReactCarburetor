import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// See DevelopmentFlag.ts: the literal member expression is what bundlers substitute.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/** This module's own identity: stable here, distinct from any other copy's evaluation of it. */
const copyMarker: object = {};

/** One shared value's slot: who created it, and whether a mismatch was already reported. */
interface ISharedEntry<T> {
    value: T;
    copy: object;
    react: unknown;
    reported: boolean;
}

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
export const sharedSingleton = <T>(name: string, create: () => T, react?: unknown): T => {
    const registry = globalThis as {[key: symbol]: ISharedEntry<T> | undefined};
    const key = Symbol.for(`react-carburetor/v1/${name}`);
    const existing = registry[key];

    if (existing) {
        const foreignCopy = existing.copy !== copyMarker;
        const foreignReact = react !== undefined && existing.react !== react;

        if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'production'
            && (foreignCopy || foreignReact) && !existing.reported) {
            existing.reported = true;

            diagnostics.report(
                `two copies of react-carburetor share this process for "${name}" — a duplicated ` +
                'install, or the package loaded through two different module formats at once. ' +
                'Dedupe the install, or make sure only one module format is loaded.' +
                (foreignReact
                    ? ' The copies also imported different React modules — align them to one React install.'
                    : '')
            );
        }

        return existing.value;
    }

    const created: ISharedEntry<T> = {value: create(), copy: copyMarker, react, reported: false};

    registry[key] = created;

    return created.value;
};
