import {Carburetor} from '@/Carburetor';

interface IData {
    tick: number;
    noise: number;
    tree: {value: number};
}

class TickCarburetor extends Carburetor<IData> {
    public edit = (fn: (draft: IData) => void): void => {
        this.update(fn);
    };
}

interface IConstructorCounts {
    weakmaps: number;
    weaksets: number;
}

/** Counts WeakMap/WeakSet constructions while `run` executes; native semantics preserved. */
const countConstructors = (run: () => void): IConstructorCounts => {
    const counts: IConstructorCounts = {weakmaps: 0, weaksets: 0};
    const realWeakMap = WeakMap;
    const realWeakSet = WeakSet;
    const WeakMapCounter = class extends realWeakMap {
        public constructor(...args: ConstructorParameters<typeof realWeakMap>) {
            counts.weakmaps++;
            super(...args);
        }
    };
    const WeakSetCounter = class extends realWeakSet {
        public constructor(...args: ConstructorParameters<typeof realWeakSet>) {
            counts.weaksets++;
            super(...args);
        }
    };
    (globalThis as Record<string, unknown>).WeakMap = WeakMapCounter;
    (globalThis as Record<string, unknown>).WeakSet = WeakSetCounter;
    try {
        run();
    } finally {
        (globalThis as Record<string, unknown>).WeakMap = realWeakMap;
        (globalThis as Record<string, unknown>).WeakSet = realWeakSet;
    }
    return counts;
};

describe('a primitive selection wake allocates no graph collections (R37-05)', () => {
    test('an equivalent scalar wake constructs zero WeakMaps and WeakSets and delivers nothing', () => {
        const store = new TickCarburetor({tick: 0, noise: 0, tree: {value: 0}});
        let callbacks = 0;
        const stop = store.watch((data: IData) => data.tick % 2, () => { callbacks++; });
        // Warmup: first draft access allocates the write proxy, before the counted window.
        store.edit((draft) => { draft.noise = -1; });

        const counts = countConstructors(() => {
            store.edit((draft) => { draft.noise = 1; draft.tick = 2; });
        });

        expect(counts.weakmaps).toBe(0);
        expect(counts.weaksets).toBe(0);
        expect(callbacks).toBe(0);
        stop();
    });

    test('a changed scalar still delivers, with zero constructor cost', () => {
        const store = new TickCarburetor({tick: 0, noise: 0, tree: {value: 0}});
        const seen: number[] = [];
        const stop = store.watch((data: IData) => data.tick % 2, (next) => { seen.push(next); });
        // Warmup: first draft access allocates the write proxy, before the counted window.
        store.edit((draft) => { draft.noise = -1; });

        const counts = countConstructors(() => {
            store.edit((draft) => { draft.tick = 3; });
        });

        expect(counts.weakmaps).toBe(0);
        expect(counts.weaksets).toBe(0);
        expect(seen).toEqual([1]);
        stop();
    });

    test('control: a shared object selection wake still constructs graph ledgers', () => {
        const tree: {value: number; peer?: unknown} = {value: 0};
        const store = new TickCarburetor({tick: 0, noise: 0, tree});
        let latest: unknown = undefined;
        const stop = store.watch((data: IData) => data.tree, (next) => { latest = next; });

        store.edit((draft) => { (draft.tree as {peer?: unknown}).peer = new Map([['self', draft.tree]]); });

        const counts = countConstructors(() => {
            store.edit((draft) => { draft.tree.value = 5; });
        });

        // The shared snapshot takes the full reconcile: its ledgers must exist.
        expect(counts.weakmaps).toBeGreaterThan(0);
        expect((latest as {value: number}).value).toBe(5);
        stop();
    });
});
