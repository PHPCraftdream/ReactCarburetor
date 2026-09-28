import {Carburetor} from '@/Carburetor';
import {TPath} from '@/Carburetor/Models/Paths';
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

        // Enumeration records 'leaf.~k' (R16-01), the key set the write below changes — not
        // 'leaf', which every value write under an unchanged key set would also match.
        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count', 'keep']);
        expect(reads.has('leaf.~k')).toBe(true);
        expect(reads.has('leaf')).toBe(false);

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

    test('a no-op write keeps the same wrapper; a real write mints a fresh one', () => {
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

        // Rewriting the branch with the value it already holds is a no-op: the raw object
        // identity never changes, so the next consult keeps the wrapper as it is.
        store.rewriteLeaf(wrapper as ILeaf);

        let again: unknown = undefined;

        store.edit((draft: ITree) => {
            again = draft.leaf;
        });

        expect(cache.owns('leaf', rawLeaf)).toBe(true);
        expect(again).toBe(wrapper);

        // A real branch write replaces the raw object: the next read mints a fresh wrapper.
        const freshLeaf: ILeaf = {zero: 1, nan: NaN, count: 1, keep: {title: 'fresh'}};

        store.rewriteLeaf(freshLeaf);

        let fresh: unknown = undefined;

        store.edit((draft: ITree) => {
            fresh = draft.leaf;
        });

        expect(fresh).not.toBe(wrapper);
        expect(cache.owns('leaf', freshLeaf)).toBe(true);
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

interface IProbeData {
    leaf: {count: number; keep: {title: string}};
    index: Map<string, number>;
}

const getProbeData = (): IProbeData => ({leaf: {count: 0, keep: {title: 'kept'}}, index: new Map([['a', 1]])});

/**
 * A store whose methods only read through draft, never write, so emitUpdate publishes exactly
 * what `get` itself recorded — the R15-08 regression surface: building a path only where it is
 * used must not change what a bare read records.
 */
class ProbeCarburetor extends Carburetor<IProbeData> {
    public peekCount = (): void => {
        void this.draft.leaf.count;
        this.emitUpdate();
    };

    public peekBranch = (): void => {
        void this.draft.leaf.keep;
        this.emitUpdate();
    };

    public peekOpaque = (): void => {
        void this.draft.index;
        this.emitUpdate();
    };
}

describe('R15-08: building the write-proxy path only where it is used records exactly what it used to', () => {
    test('reading a primitive leaf through draft, with no write, records nothing', () => {
        const store = new ProbeCarburetor(getProbeData());
        let wakes = 0;

        store.subscribe(() => wakes++, {id: 'count-reader', reads: new Set<TPath>(['leaf.count'])});

        store.peekCount();

        expect(wakes).toEqual(0);
    });

    test('reading a trackable branch through draft, with no write inside it, records nothing', () => {
        const store = new ProbeCarburetor(getProbeData());
        let wakes = 0;

        store.subscribe(() => wakes++, {id: 'branch-reader', reads: new Set<TPath>(['leaf.keep'])});

        store.peekBranch();

        expect(wakes).toEqual(0);
    });

    test('reading an opaque (unwrappable) value through draft still records its own path, precisely', () => {
        const store = new ProbeCarburetor(getProbeData());
        let indexWakes = 0;
        let unrelatedWakes = 0;

        store.subscribe(() => indexWakes++, {id: 'index-reader', reads: new Set<TPath>(['index'])});
        store.subscribe(() => unrelatedWakes++, {id: 'count-reader', reads: new Set<TPath>(['leaf.count'])});

        store.peekOpaque();

        expect(indexWakes).toEqual(1);
        expect(unrelatedWakes).toEqual(0);
    });
});

describe('R16-01: defineProperty and deleteProperty wake an enumerator only on a real key-set change', () => {
    test('defineProperty of a new key wakes an enumerator; redefining an existing one does not', () => {
        const store = new LeafCarburetor(getTree());
        const reads = new Set<TPath>();
        const view = store.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count', 'keep']);

        store.subscribe(() => wakes++, {id: 'keys-reader', reads});

        const descriptor = (value: unknown): PropertyDescriptor =>
            ({value, enumerable: true, configurable: true, writable: true});

        // Redefining `count` with the same key changes no key, only its descriptor.
        store.edit((draft: ITree) => {
            Object.defineProperty(draft.leaf, 'count', descriptor(1));
        });
        expect(wakes).toEqual(0);

        // Defining a key the leaf never had changes the key set.
        store.edit((draft: ITree) => {
            Object.defineProperty(draft.leaf, 'label', descriptor('x'));
        });
        expect(wakes).toEqual(1);
        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count', 'keep', 'label']);
    });

    test('deleteProperty of an existing own key wakes an enumerator', () => {
        const store = new LeafCarburetor(getTree());
        const reads = new Set<TPath>();
        const view = store.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count', 'keep']);

        store.subscribe(() => wakes++, {id: 'keys-reader', reads});

        // Deleting a key the leaf never had is a no-op for the key set.
        store.edit((draft: ITree) => {
            delete (draft.leaf as unknown as Record<string, unknown>).absent;
        });
        expect(wakes).toEqual(0);

        store.edit((draft: ITree) => {
            delete (draft.leaf as {keep?: {title: string}}).keep;
        });
        expect(wakes).toEqual(1);
        expect(Object.keys(view.leaf)).toEqual(['zero', 'nan', 'count']);
    });
});
