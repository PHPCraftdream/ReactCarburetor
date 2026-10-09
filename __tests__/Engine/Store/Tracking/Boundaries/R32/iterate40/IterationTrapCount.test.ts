import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';

interface ICounts {
    get: number;
    has: number;
}

/** Instruments the real handler, so direct fast-path calls are counted as well as dispatch. */
const countHandlers = (run: () => void): ICounts => {
    const OriginalProxy = globalThis.Proxy;
    const counts: ICounts = {get: 0, has: 0};
    function SpyProxy(target: object, handler: ProxyHandler<object>): object {
        for (const trap of ['get', 'has'] as const) {
            const original = handler[trap];
            if (original === undefined) continue;
            Object.defineProperty(handler, trap, {
                configurable: true,
                value: (...args: unknown[]): unknown => {
                    if (typeof args[1] === 'string' && /^(0|[1-9]\d*)$/.test(args[1])) counts[trap]++;

                    return Reflect.apply(original, handler, args);
                },
            });
        }

        return Reflect.construct(OriginalProxy, [target, handler]);
    }

    globalThis.Proxy = SpyProxy as unknown as ProxyConstructor;
    try {
        run();
    } finally {
        globalThis.Proxy = OriginalProxy;
    }

    return counts;
};

describe('R40-03: one handler get per element without has', () => {
    for (const method of ['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'reduce'] as const) {
        test(method + ': holes alone use has; find methods visit holes with get', () => {
            const counts = countHandlers(() => {
                const raw = [1, 2, 3];
                Reflect.deleteProperty(raw, '1');
                const view = createReadProxy(raw, () => undefined);
                const callback = (): boolean => method === 'every';
                Reflect.apply(view[method], view, [callback, 0]);
            });
            expect(counts).toEqual(method === 'find' || method === 'findIndex'
                ? {get: 3, has: 0} : {get: 2, has: 1});
        });
    }

    for (const method of ['map', 'filter', 'forEach'] as const) {
        test(method + ': 1000 elements, raw control and native trap-path read-set equality', () => {
            const raw = Array.from({length: 1000}, (_, index) => index);
            const callback = (value: number): number | boolean => method === 'filter' ? value % 2 === 0 : value + 1;
            let rawResult: unknown;
            const rawCounts = countHandlers(() => {
                rawResult = Array.prototype[method].call(raw, callback);
            });
            const nativeReads = new Set<string>();
            let nativeResult: unknown;
            const nativeCounts = countHandlers(() => {
                const view = createReadProxy({rows: raw}, path => nativeReads.add(path)).rows;
                nativeResult = Array.prototype[method].call(view, callback);
            });
            const fastReads = new Set<string>();
            let fastResult: unknown;
            const fastCounts = countHandlers(() => {
                const view = createReadProxy({rows: raw}, path => fastReads.add(path)).rows;
                fastResult = view[method](callback);
            });
            const expectedReads = ['rows.~p', 'rows.length', ...raw.map(index => 'rows.' + index)].sort();

            expect(rawCounts).toEqual({get: 0, has: 0});
            expect(nativeCounts).toEqual({get: 1000, has: 1000});
            expect(nativeResult).toEqual(rawResult);
            expect(fastResult).toEqual(rawResult);
            expect([...nativeReads].sort()).toEqual(expectedReads);
            expect([...fastReads].sort()).toEqual(expectedReads);
            expect([...fastReads].sort()).toEqual([...nativeReads].sort());
            expect(fastCounts).toEqual({get: 1000, has: 0});
        });
    }
});
