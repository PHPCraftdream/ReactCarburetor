/**
 * Counts handler calls, including direct calls made by the callback fast path.
 *
 * @param run - Instrumented operation.
 */
export const countHandlers = run => {
    const Original = globalThis.Proxy;
    const counts = {get: 0, has: 0};
    const originals = new Map();
    /**
     * Wraps a proxy handler with trap counters.
     *
     * @param target - Proxy target.
     * @param handler - Original handler.
     */
    function Spy(target, handler) {
        if (originals.has(handler)) return Reflect.construct(Original, [target, handler]);
        originals.set(handler, Object.getOwnPropertyDescriptors(handler));
        for (const trap of ['get', 'has']) {
            const original = handler[trap];
            if (!original) continue;
            Object.defineProperty(handler, trap, {configurable: true, value: (...args) => {
                if (Array.isArray(args[0]) && typeof args[1] === 'string'
                    && /^(0|[1-9]\d*)$/.test(args[1])) counts[trap]++;
                return Reflect.apply(original, handler, args);
            }});
        }
        return Reflect.construct(Original, [target, handler]);
    }
    globalThis.Proxy = Spy;
    try { run(counts); } finally {
        globalThis.Proxy = Original;
        for (const [handler, descriptors] of originals) {
            for (const trap of ['get', 'has']) {
                if (descriptors[trap]) Object.defineProperty(handler, trap, descriptors[trap]);
                else delete handler[trap];
            }
        }
    }
    return counts;
};
