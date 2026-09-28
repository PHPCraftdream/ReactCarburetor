/**
 * Whether any symbol-keyed own property differs between two objects — added, removed or
 * changed value.
 *
 * `diffPaths` and `applyDiff` do not chase a difference under a symbol key: a symbol has no
 * place in a dotted path, the same reason a write through one already collapses onto the
 * wildcard (`WriteProxyHandler.writtenPath`). A caller that finds one here falls back to
 * treating the whole container as replaced instead of naming a path for a key that has none.
 *
 * @param a - one side of the comparison.
 * @param b - the other side.
 */
export const hasSymbolDifference = (a: object, b: object): boolean => {
    const keys = new Set<symbol>([...Object.getOwnPropertySymbols(a), ...Object.getOwnPropertySymbols(b)]);

    for (const key of keys) {
        if (!Object.is((a as Record<symbol, unknown>)[key], (b as Record<symbol, unknown>)[key])) {
            return true;
        }
    }

    return false;
};
