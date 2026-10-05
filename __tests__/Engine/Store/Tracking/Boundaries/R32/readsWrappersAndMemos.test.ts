import {Carburetor} from '@/Carburetor';
import {PROXY_CACHE, RAW_TARGET} from '@/Carburetor/Store/Tracking/Models';

interface IRow {
    title: string;
    done: boolean;
}

interface IData {
    byId: Record<string, IRow | number>;
}

const makeStore = (): Carburetor<IData> =>
    new Carburetor<IData>({byId: {a: {title: 't', done: false}, b: {title: 'u', done: true}, c: 5}});

/** Views type values as the union the store declares; reads here know which kind they touch. */
const rowOf = (value: unknown): IRow => value as IRow;

/** Runs `run` with the global `Proxy` constructor counting every `new Proxy` it performs. */
const countProxies = (run: () => void): number => {
    const OriginalProxy = Proxy;
    let count = 0;

    function SpyProxy(target: object, handler: object): object {
        count++;

        return Reflect.construct(OriginalProxy, [target, handler]);
    }

    SpyProxy.prototype = OriginalProxy.prototype;
    globalThis.Proxy = SpyProxy as unknown as typeof Proxy;
    try {
        run();
    } finally {
        globalThis.Proxy = OriginalProxy;
    }

    return count;
};

describe('R32-06: enumeration wrappers are cheaper', () => {
    test('the cache entry for a branch is its read handler, not a separate record', () => {
        const store = makeStore();
        const view = store.read(() => undefined);
        const raw = (view.byId as Record<PropertyKey, unknown>)[RAW_TARGET] as object;
        const cache = (view.byId as Record<PropertyKey, unknown>)[PROXY_CACHE] as {
            entries: WeakMap<object, {path: string; proxy?: object}>;
        };

        const entry = cache.entries.get(raw) as object;

        // The entry is the branch's own handler — it carries the wrapper and its path and is
        // no plain `{path, proxy}` record — so a wrapped branch costs one object, not two.
        expect(entry).toBeDefined();
        expect((entry as {path: string}).path).toEqual('byId');
        expect((entry as {proxy?: object}).proxy).toBe(view.byId);
        expect(Object.getPrototypeOf(entry)).not.toBe(Object.prototype);
    });

    test('enumeration builds one wrapper per value, and a warm pass builds none', () => {
        const rows = Object.fromEntries(
            Array.from({length: 200}, (_, n) => ['k' + n, {title: 't' + n, done: n % 2 === 0}])
        );
        const store = new Carburetor<IData>({byId: rows});
        const view = store.read(() => undefined);

        expect(countProxies(() => Object.keys(view.byId))).toEqual(201);

        expect(countProxies(() => Object.keys(view.byId))).toEqual(0);
        expect(countProxies(() => {
            for (const key in view.byId) void key;
        })).toEqual(0);
    });

    test('wrappers built by enumeration alone carry no path memos', () => {
        const rows = Object.fromEntries(
            Array.from({length: 50}, (_, n) => ['k' + n, {title: 't' + n, done: n % 2 === 0}])
        );
        const store = new Carburetor<IData>({byId: rows});
        const view = store.read(() => undefined);
        const cache = (view.byId as Record<PropertyKey, unknown>)[PROXY_CACHE] as {
            entries: WeakMap<object, object>;
        };

        Object.keys(view.byId);

        for (let index = 0; index < 50; index++) {
            const raw = Object.getOwnPropertyDescriptor(rows, 'k' + index)?.value;
            const entry = cache.entries.get(raw as object) as {memos?: unknown} | undefined;

            // The wrapper must be a handler (not a plain record) and carry no path memos.
            expect(entry).toBeDefined();
            expect(Object.getPrototypeOf(entry as object)).not.toBe(Object.prototype);
            expect(entry?.memos).toBeUndefined();
        }
    });
});

describe('R32-04: path memos are bounded by the live key set', () => {
    test('a rolling key window keeps the memo maps small and the answers correct', () => {
        class WindowStore extends Carburetor<IData> {
            /** Adds one key and drops the oldest. */
            public churn(index: number): void {
                this.update(draft => {
                    draft.byId['m' + index] = {title: 't', done: false};
                    if (index >= 100) delete draft.byId['m' + (index - 100)];
                });
            }
        }

        const store = new WindowStore({byId: {}});
        const view = store.read(() => undefined);
        const raw = (view.byId as Record<PropertyKey, unknown>)[RAW_TARGET] as object;
        const cache = (view.byId as Record<PropertyKey, unknown>)[PROXY_CACHE] as {
            entries: WeakMap<object, {memos?: {childPaths?: Map<string, string>}}>;
        };

        for (let index = 0; index < 3000; index++) {
            store.churn(index);

            if (index >= 99) {
                const live = rowOf(view.byId['m' + (index - 99)]);

                expect(live.title).toEqual('t');
            }
        }

        // The handler's own memo map is the footprint: it must exist (the entry is the
        // handler) and stay a small fraction of the keys the window ever wrote.
        const memo = cache.entries.get(raw)?.memos;

        expect(memo).toBeDefined();
        expect(memo?.childPaths).toBeDefined();
        expect(memo?.childPaths?.size ?? Infinity).toBeLessThanOrEqual(300);

        const keys = Object.keys(view.byId);

        expect(keys.length).toEqual(100);
        expect(keys).toContain('m2999');
        expect(keys).not.toContain('m2899');
    });

    test('clearing the memos records the same paths again', () => {
        const store = makeStore();
        const paths: string[] = [];
        const view = store.read(path => paths.push(path));

        void rowOf(view.byId.a).title;
        void rowOf(view.byId.b).title;

        const before = paths.slice();
        paths.length = 0;

        void rowOf(view.byId.a).title;
        void rowOf(view.byId.b).title;

        expect(paths).toEqual(before);
    });
});

describe('R32 reads: recorded paths are identical to baseline', () => {
    test('get/has/ownKeys/getOwnPropertyDescriptor/for-in/values record the reference set', () => {
        const store = makeStore();
        const paths: string[] = [];
        const view = store.read(path => paths.push(path));

        void view.byId;
        void rowOf(view.byId.a).title;
        void ('a' in view.byId);
        void ('zz' in view.byId);
        void Boolean(view.byId.b);
        Object.keys(view.byId);
        for (const key in view.byId) void key;
        Object.values(view.byId);
        void rowOf(view.byId.a).done;
        void view.byId.c;

        expect(paths).toEqual([
            'byId.~p',
            'byId.~p',
            'byId.a.~p',
            'byId.a.title',
            'byId.~p',
            'byId.a.~p',
            'byId.~p',
            'byId.zz',
            'byId.~p',
            'byId.b.~p',
            'byId.~p',
            'byId.~k',
            'byId.~p',
            'byId.~k',
            'byId.~p',
            'byId.~k',
            'byId.a.~p',
            'byId.b.~p',
            'byId.c',
            'byId.~p',
            'byId.a.~p',
            'byId.a.done',
            'byId.~p',
            'byId.c',
        ]);
    });
});
