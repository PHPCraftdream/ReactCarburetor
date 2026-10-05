import {Carburetor} from '@/Carburetor';
import {DIFF_PATH_THRESHOLD} from '@/Carburetor/Store/Paths/Diff/DiffThreshold';
import {IProxyCache, PROXY_CACHE} from '@/Carburetor/Store/Tracking/Models';

interface IRowsData {
    rows: Array<{n: number}>;
}

/** Exposes the draft tree's proxy cache, so a test can tell whether a branch was ever wrapped. */
class RowsCarburetor extends Carburetor<IRowsData> {
    public proxyCache = (): IProxyCache =>
        (this.draft as unknown as Record<symbol, IProxyCache>)[PROXY_CACHE];
}

const getRows = (count: number): IRowsData =>
    ({rows: Array.from({length: count}, (_, index) => ({n: index}))});

describe('restore skips draft wrapping of unchanged branches (R34-D)', () => {
    test('restoring one changed leaf among 100 wraps only that leaf, not its siblings', () => {
        const store = new RowsCarburetor(getRows(100));
        const rawRows = store.getData().rows;
        const snapshot = getRows(100);
        snapshot.rows[50].n = 999;

        // Reading the cache before restore keeps the dev 'draft without emit' check quiet:
        // restore's own emitUpdate covers this draft touch.
        const cache = store.proxyCache();
        store.restore(snapshot);

        expect(store.getData().rows[50].n).toEqual(999);
        // Unchanged rows keep their raw identity and were never wrapped in a write proxy.
        expect(store.getData().rows[0]).toBe(rawRows[0]);
        expect(store.getData().rows[99]).toBe(rawRows[99]);
        expect(cache.owns('rows.0', rawRows[0])).toBe(false);
        expect(cache.owns('rows.49', rawRows[49])).toBe(false);
        expect(cache.owns('rows.99', rawRows[99])).toBe(false);
        expect(cache.owns('rows.50', rawRows[50])).toBe(true);
    });

    test('a changed leaf is applied and wakes only its reader', () => {
        const store = new RowsCarburetor(getRows(4));
        let wakes = 0;
        store.subscribe(() => wakes++, {id: 'reader', reads: new Set(['rows.2.n'])});

        const snapshot = getRows(4);
        snapshot.rows[2].n = 42;
        store.restore(snapshot);

        expect(store.getData().rows[2].n).toEqual(42);
        expect(wakes).toEqual(1);
    });

    test('an added key and a deleted key are applied', () => {
        const store = new Carburetor<Record<string, {v: number}>>({a: {v: 1}, b: {v: 2}});
        const snapshot = {a: {v: 1}, c: {v: 3}};
        store.restore(snapshot);

        expect(Object.keys(store.getData())).toEqual(['a', 'c']);
        expect(store.getData().c?.v).toEqual(3);
    });

    test('an installable key order change is applied natively', () => {
        const store = new Carburetor<Record<string, number>>({a: 1, b: 2, c: 3});
        const snapshot = {a: 1, b: 2}; // a tail deletion: installable by native deletion

        store.restore(snapshot as Record<string, number>);

        expect(Object.keys(store.getData())).toEqual(['a', 'b']);
        expect(store.getData().b).toEqual(2);
    });

    test('a key order that requires replay falls back to a root replacement equal to the snapshot', () => {
        const store = new Carburetor<Record<string, number>>({a: 1, b: 2});
        let wakes = 0;
        store.subscribe(() => wakes++, {id: 'watcher'});

        const snapshot = {b: 2, a: 1};
        store.restore(snapshot);

        expect(Object.keys(store.getData())).toEqual(['b', 'a']);
        expect(store.getData()).not.toBe(snapshot);
        expect(wakes).toEqual(1);
    });

    test('a locked readonly branch with an equal value is skipped while a sibling is applied', () => {
        const root: {keep: {v: number}; other: number} = {keep: {v: 1}, other: 1};
        Object.defineProperty(root, 'keep', {
            value: root.keep, writable: false, enumerable: true, configurable: false,
        });
        const store = new Carburetor<{keep: {v: number}; other: number}>(root);
        const keepBefore = store.getData().keep;

        const snapshot = {keep: {v: 1}, other: 2};
        store.restore(snapshot);

        expect(store.getData().other).toEqual(2);
        expect(store.getData().keep).toBe(keepBefore);
        expect(store.getData().keep.v).toEqual(1);
    });

    test('a locked readonly branch with an unequal value falls back to a root replacement', () => {
        const root: {keep: {v: number}; other: number} = {keep: {v: 1}, other: 1};
        Object.defineProperty(root, 'keep', {
            value: root.keep, writable: false, enumerable: true, configurable: false,
        });
        const store = new Carburetor<{keep: {v: number}; other: number}>(root);

        const snapshot = {keep: {v: 5}, other: 1};
        store.restore(snapshot);

        expect(store.getData().keep.v).toEqual(5);
        expect(store.getData().other).toEqual(1);
        expect(store.getData()).not.toBe(snapshot);
    });

    test('an array length change is applied', () => {
        const store = new Carburetor<{rows: number[]}>({rows: [1, 2, 3]});

        store.restore({rows: [1, 2, 3, 4, 5]});
        expect(store.getData().rows).toEqual([1, 2, 3, 4, 5]);

        store.restore({rows: [1]});
        expect(store.getData().rows).toEqual([1]);
    });

    test('a locked array length falls back to a root replacement equal to the snapshot', () => {
        const store = new Carburetor<{rows: number[]}>({rows: [1, 2, 3]});
        Object.defineProperty(store.getData().rows, 'length', {writable: false});

        const snapshot = {rows: [1, 2, 3, 4]};
        store.restore(snapshot);

        expect(store.getData().rows).toEqual([1, 2, 3, 4]);
        expect(store.getData()).not.toBe(snapshot);
    });

    test(`past DIFF_PATH_THRESHOLD (${DIFF_PATH_THRESHOLD}) differing leaves restore replaces the root`, () => {
        const makeDict = (offset: number): Record<string, number> => {
            const result: Record<string, number> = {};

            for (let i = 0; i < DIFF_PATH_THRESHOLD + 100; i++) {
                result['k' + i] = i + offset;
            }

            return result;
        };

        const store = new Carburetor<Record<string, number>>(makeDict(0));
        const snapshot = makeDict(1);
        store.restore(snapshot);

        expect(store.getData()).toEqual(snapshot);
        expect(store.getData()).not.toBe(snapshot);
    });
});
