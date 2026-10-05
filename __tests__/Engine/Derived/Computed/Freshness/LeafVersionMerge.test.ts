import {Carburetor, computed} from '@/Carburetor';
import {captureLeafVersions} from '@/Carburetor/Derived/Freshness/captureLeafVersions';
import {IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';
import {TPath} from '@/Carburetor/Models/Paths';

interface IFakeComputed {
    getUID: () => string;
    getVersion: () => number;
    subscribe: () => string;
    unsubscribe: () => void;
}

/** A stand-in for an inner computed whose flattened leaf versions the capture reads. */
const makeInnerComputed = (id: string, leaves: {source: IFakeComputed; reads: string[]}[]): IFakeComputed => {
    const source: IFakeComputed = {
        getUID: () => id,
        getVersion: () => 0,
        subscribe: () => id,
        unsubscribe: () => undefined,
    };
    computedDependencies.versions.set(
        source as unknown as IReadSet['source'],
        () => Object.fromEntries(leaves.map((leaf, n) => [String(n), {
            source: leaf.source as unknown as IReadSet['source'],
            version: leaf.source.getVersion(),
            reads: new Set<TPath>(leaf.reads),
        }]))
    );

    return source;
};

/** A minimal store source: carrying `read` keeps captureLeafVersions from flattening it. */
const makeStoreSource = (id: string): IFakeComputed => ({
    getUID: () => id,
    getVersion: () => 0,
    subscribe: () => id,
    unsubscribe: () => undefined,
});

describe('captureLeafVersions fan-in merge (R32-02)', () => {
    test('merges inner computeds sharing one store leaf into one fresh set without mutating inputs', () => {
        const store = makeStoreSource('store-1');
        const first = makeInnerComputed('c1', [{source: store, reads: ['a', 'b', 'c']}]);
        const second = makeInnerComputed('c2', [{source: store, reads: ['d', 'e']}]);
        const firstReads = computedDependencies.versions.get(first as unknown as IReadSet['source'])!()[0]
            .reads as Set<string>;
        const secondReads = computedDependencies.versions.get(second as unknown as IReadSet['source'])!()[0]
            .reads as Set<string>;
        const versions = {};

        captureLeafVersions({d1: {source: first as unknown as IReadSet['source'], reads: new Set<TPath>(['c1'])},
            d2: {source: second as unknown as IReadSet['source'], reads: new Set<TPath>(['c2'])}}, versions);

        const key = ':store-1';
        expect(versions[key].reads.size).toEqual(5);
        expect([...(versions[key].reads as Set<string>)].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
        // The inner computeds' own read sets must survive untouched.
        expect(firstReads.size).toEqual(3);
        expect(secondReads.size).toEqual(2);
        expect(versions[key].reads).not.toBe(firstReads);
        expect(versions[key].reads).not.toBe(secondReads);
    });

    test('a second capture never appends into the sets a previous capture produced', () => {
        const store = makeStoreSource('store-2');
        const first = makeInnerComputed('c1', [{source: store, reads: ['a', 'b']}]);
        const second = makeInnerComputed('c2', [{source: store, reads: ['c', 'd']}]);
        const deps = {d1: {source: first as unknown as IReadSet['source'], reads: new Set<TPath>(['c1'])},
            d2: {source: second as unknown as IReadSet['source'], reads: new Set<TPath>(['c2'])}};
        const announced = {};

        captureLeafVersions(deps, announced);
        const announcedReads = announced[':store-2'].reads as Set<string>;
        const announcedSize = announcedReads.size;

        const again = {};
        captureLeafVersions(deps, again);

        expect(announcedReads.size).toEqual(announcedSize);
        expect(again[':store-2'].reads).not.toBe(announcedReads);
    });
});

interface IRowData {
    rows: {a: number; b: number; c: number; d: number; e: number}[];
}

describe('computed fan-in over one shared store (R32-02)', () => {
    const K = 128;
    const FIELDS = 5;

    test('one outer recompute performs O(K·M) set insertions, not O(K²·M)', () => {
        class RowStore extends Carburetor<IRowData> {
            public bump(): void {
                this.update((draft: IRowData) => { draft.rows[K - 1].a++; });
            }
        }

        const store = new RowStore({
            rows: Array.from({length: K}, (_, n) => ({a: n, b: n, c: n, d: n, e: n})),
        });
        const inner = Array.from({length: K}, (_, n: number) =>
            computed((read: (data: object) => IRowData) => {
                const row = read(store).rows[n];

                return row.a + row.b + row.c + row.d + row.e;
            }));

        let insertions = 0;
        const originalAdd = Set.prototype.add;
        Set.prototype.add = function add(value: unknown): Set<unknown> {
            insertions++;
            return originalAdd.call(this, value);
        };

        let outerRecomputes = 0;
        let wakes = 0;
        const outer = computed((read: (value: object) => number) => {
            outerRecomputes++;
            return inner.reduce((sum: number, item: object) => sum + read(item), 0);
        });
        const watcher = outer.subscribe(() => wakes++);
        outer.get();
        insertions = 0;

        store.bump();
        const value = outer.get();

        Set.prototype.add = originalAdd;
        outer.unsubscribe(watcher);

        expect(value).toEqual(FIELDS * (K * (K - 1) / 2) + 1);
        // Set construction from an iterable also goes through add: the fixed merge costs
        // O(K·M) insertions in total; the old copy-per-merge cost K²·M/2.
        expect(insertions).toBeLessThanOrEqual(3 * K * FIELDS);
        // The fix must not change the recompute or wake counts.
        expect(outerRecomputes).toEqual(2);
        expect(wakes).toEqual(1);
    });
});
