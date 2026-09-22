import {Carburetor, TPath} from '@/Carburetor';
import {IProxyCache, PROXY_CACHE} from '@/Carburetor/Store/Tracking/Models';

interface ILeaf {
    flag?: undefined;
    zero: number;
    nan: number;
    count: number;
    keep: {title: string};
}

interface ITree {
    leaf: ILeaf;
}

const getTree = (): ITree => ({
    leaf: {zero: 0, nan: NaN, count: 0, keep: {title: 'kept'}},
});

class LeafCarburetor extends Carburetor<ITree> {
    /** Assigns `undefined` to `flag`, a key the leaf does not have yet. */
    public writeFlag = (): void => {
        this.update((draft: ITree) => {
            draft.leaf.flag = undefined;
        });
    };

    /** Assigns a number over the leaf's `zero` key, so signed zeros travel through draft. */
    public writeZero = (zero: number): void => {
        this.update((draft: ITree) => {
            draft.leaf.zero = zero;
        });
    };

    /** Assigns a number over the leaf's `nan` key, so NaN writes travel through draft. */
    public writeNan = (nan: number): void => {
        this.update((draft: ITree) => {
            draft.leaf.nan = nan;
        });
    };

    /** Assigns a number over the leaf's `count` key, the plain same-value control. */
    public writeCount = (count: number): void => {
        this.update((draft: ITree) => {
            draft.leaf.count = count;
        });
    };

    /** Runs an arbitrary mutation through draft, for tests that capture values mid-write. */
    public edit = (mutate: (draft: ITree) => void): void => {
        this.update(mutate);
    };

    /** Rewrites the whole leaf branch, with whatever value the caller passes. */
    public rewriteLeaf = (next: ILeaf): void => {
        this.update((draft: ITree) => {
            draft.leaf = next;
        });
    };
}

/** The cache handle a tracking proxy answers its introspection symbol with. */
const cacheOf = (branch: unknown): IProxyCache =>
    (branch as Record<symbol, IProxyCache>)[PROXY_CACHE];

/** The own-property check, in the form the library itself uses. */
const hasOwn = (source: object, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(source, key);

describe('the write proxy skips only SameValue no-ops over existing own keys (R2-11)', () => {
    test('assigning `undefined` to an absent key creates the key and is a real write', () => {
        const store = new LeafCarburetor(getTree());
        const leaf = store.getData().leaf;
        const versionBefore = store.getVersion();

        store.writeFlag();

        // The key now exists: `in`, enumeration and the own-property check all see it,
        // though the value it holds reads as `undefined` exactly like the missing key did.
        expect(hasOwn(leaf, 'flag')).toBe(true);
        expect('flag' in leaf).toBe(true);
        expect(Object.keys(leaf)).toContain('flag');

        // The write was real, not the no-op `undefined === undefined` suggests.
        expect(store.getVersion()).toEqual(versionBefore + 1);
    });

    test('the created key wakes a subscriber that checked presence', () => {
        const store = new LeafCarburetor(getTree());
        const reads = new Set<TPath>();
        const view = store.read((path: TPath) => reads.add(path));
        let wakes = 0;

        // The presence check records 'leaf.flag': the exact path the write must announce.
        expect('flag' in view.leaf).toBe(false);
        expect(reads.has('leaf.flag')).toBe(true);

        store.subscribe(() => wakes++, {id: 'flag-reader', reads});

        store.writeFlag();

        expect(wakes).toEqual(1);
        expect('flag' in view.leaf).toBe(true);
    });

    test('the created key wakes a subscriber that enumerated keys', () => {
        const store = new LeafCarburetor(getTree());
        const reads = new Set<TPath>();
        const view = store.read((path: TPath) => reads.add(path));
        let wakes = 0;

        // Enumeration records 'leaf', the structure the write below changes.
        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count', 'keep']);
        expect(reads.has('leaf')).toBe(true);

        store.subscribe(() => wakes++, {id: 'keys-reader', reads});

        store.writeFlag();

        expect(wakes).toEqual(1);
        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count', 'keep', 'flag']);
    });

    test('writing -0 over +0 is a real write, and so is +0 over -0', () => {
        const store = new LeafCarburetor(getTree());
        const leaf = store.getData().leaf;
        let wakes = 0;

        store.subscribe(() => wakes++, {id: 'zero-reader', reads: new Set<TPath>(['leaf.zero'])});

        store.writeZero(-0);

        // Object.is is the oracle: the -0 landed, where === saw no change at all.
        expect(Object.is(leaf.zero, -0)).toBe(true);
        expect(1 / leaf.zero).toBe(-Infinity);
        expect(store.getVersion()).toEqual(1);
        expect(wakes).toEqual(1);

        store.writeZero(0);

        expect(Object.is(leaf.zero, 0)).toBe(true);
        expect(1 / leaf.zero).toBe(Infinity);
        expect(store.getVersion()).toEqual(2);
        expect(wakes).toEqual(2);
    });

    test('re-assigning the same NaN is a genuine no-op', () => {
        const store = new LeafCarburetor(getTree());
        const leaf = store.getData().leaf;
        let wakes = 0;

        store.subscribe(() => wakes++, {id: 'nan-reader', reads: new Set<TPath>(['leaf.nan'])});

        store.writeNan(NaN);

        // SameValue says the NaN already there matches the one assigned: no notification,
        // no version bump — where === announced a write every single time.
        expect(store.getVersion()).toEqual(0);
        expect(wakes).toEqual(0);
        expect(hasOwn(leaf, 'nan')).toBe(true);
    });

    test('a no-op write publishes no invalidation; a real write into the same scope does', () => {
        const store = new LeafCarburetor(getTree());
        const rawLeaf = store.getData().leaf;
        let capturedCache: unknown = undefined;
        let wrapper: unknown = undefined;

        store.edit((draft: ITree) => {
            wrapper = draft.leaf;
            capturedCache = cacheOf(draft);
        });

        const cache = capturedCache as IProxyCache;

        expect(wrapper).toBeDefined();
        expect(cache.owns('leaf', rawLeaf)).toBe(true);

        // Rewriting the branch with the value it already holds is a no-op: nothing enters
        // the invalidation ledger, so the next consult keeps the wrapper as it is.
        store.rewriteLeaf(wrapper as ILeaf);

        let again: unknown = undefined;

        store.edit((draft: ITree) => {
            again = draft.leaf;
        });

        expect(cache.pending()).toEqual(0);
        expect(cache.owns('leaf', rawLeaf)).toBe(true);
        expect(again).toBe(wrapper);

        // A real branch write publishes into the same ledger: the record stands until a
        // consult applies it.
        store.rewriteLeaf({zero: 1, nan: NaN, count: 1, keep: {title: 'fresh'}});

        expect(cache.pending()).toEqual(1);
    });

    test('re-assigning the same primitive stays a no-op', () => {
        const store = new LeafCarburetor(getTree());
        let wakes = 0;

        store.subscribe(() => wakes++, {id: 'count-reader', reads: new Set<TPath>(['leaf.count'])});

        store.writeCount(0);

        expect(store.getData().leaf.count).toEqual(0);
        expect(store.getVersion()).toEqual(0);
        expect(wakes).toEqual(0);
    });
});
