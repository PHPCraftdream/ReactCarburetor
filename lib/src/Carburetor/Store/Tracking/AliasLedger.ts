import {TPath, TAliasLedger} from "@/Carburetor/Models/Paths";
import {diagnostics} from "@/Carburetor/Store/Diagnostics/DiagnosticsInstance";

// Declared locally rather than through @types/node, as in Carburetor.ts: bundlers substitute
// this exact member expression at build time, which is what lets the strings below be dropped
// from a production bundle — an imported IS_DEVELOPMENT constant cannot be folded across
// modules, and the messages would ship dead.
declare const process: {env: {NODE_ENV?: string}} | undefined;

/**
 * The development ledger behind the aliasing contract: the read proxy notes where each branch
 * object was read, and draft complains when it writes into an object that was read somewhere
 * else, since only the written path's subscribers are woken.
 *
 * It reports only — matching never consults it. Production gets `undefined`, which folds the
 * call sites and their message strings out of the bundle.
 */
export const createAliasLedger = (): TAliasLedger => {
    if (typeof process === 'undefined' || process.env.NODE_ENV === 'production') {
        return undefined;
    }

    const seen = new WeakMap<object, TPath>();

    return {
        note: (value: object, path: TPath): void => {
            const found = seen.get(value);

            if (found !== undefined && found !== path) {
                diagnostics.report(
                    'the same object was reached at two paths, ' + found + ' and ' + path + ': ' +
                    'reads are tracked by path, so a write through one will not wake a component ' +
                    'reading the other. Keep the data a tree — one object, one path.'
                );
            }

            seen.set(value, path);
        },
        checkWrite: (source: object, path: TPath): void => {
            const found = seen.get(source);

            if (found !== undefined && found !== path) {
                diagnostics.report(
                    'a write landed in an object that was also read at ' + found + ', while the ' +
                    'write sits at ' + (path || 'the root') + ': only the written path is woken, ' +
                    'the other never hears about it. Keep the data a tree — one object, one path.'
                );
            }
        },
        forget: (value: unknown): void => {
            if (value !== null && typeof value === 'object') {
                seen.delete(value);
            }
        },
    };
};
