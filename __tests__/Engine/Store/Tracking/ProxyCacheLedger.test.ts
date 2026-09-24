import {Carburetor, TPath} from '@/Carburetor';
import {IProxyCache, PROXY_CACHE} from '@/Carburetor/Store/Tracking/Models';

const cacheOf = (branch: unknown): IProxyCache =>
    (branch as Record<symbol, IProxyCache>)[PROXY_CACHE];

interface IVisitedCache extends IProxyCache {
    visitedRecords: () => number;
}

interface IPrimitiveTree {
    items: {old?: {n: number}; count: number; keep: {title: string}};
}

const getPrimitiveTree = (): IPrimitiveTree => ({
    items: {old: {n: 1}, count: 0, keep: {title: 'kept'}},
});

class PrimitiveCarburetor extends Carburetor<IPrimitiveTree> {
    /** Deletes the items.old branch through draft and publishes the write. */
    public deleteOld = (): void => {
        this.update((draft: IPrimitiveTree) => {
            delete draft.items.old;
        });
    };

    /** Replaces the items.old branch wholesale through draft. */
    public replaceOld = (next: {n: number}): void => {
        this.update((draft: IPrimitiveTree) => {
            draft.items.old = next;
        });
    };
}

interface IEmptiedTree {
    items: {temp?: {n: number}};
}

class EmptiedCarburetor extends Carburetor<IEmptiedTree> {
    /** Deletes the items.temp branch through draft and publishes the write. */
    public deleteTemp = (): void => {
        this.update((draft: IEmptiedTree) => {
            delete draft.items.temp;
        });
    };
}

describe('primitive and enumeration reads release obsolete branches (R2-06)', () => {
    test('a primitive-only read releases a deleted branch wrapper', () => {
        const carburetor = new PrimitiveCarburetor(getPrimitiveTree());
        const removed = carburetor.getData().items.old;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        // Mint the 'items.old' entry, plus the 'items.keep' entry that must survive the sweep.
        expect(view.items.old.n).toEqual(1);
        expect(view.items.keep.title).toEqual('kept');

        const itemsCache = cacheOf(view.items);
        expect(itemsCache.owns('items.old', removed)).toBeTruthy();

        carburetor.deleteOld();

        // The write has landed, but nothing has consulted the items cache since: the sweep is
        // lazy, and this assertion pins that laziness down deterministically.
        expect(itemsCache.owns('items.old', removed)).toBeTruthy();

        // A primitive read is the production access that must release the deleted branch: no
        // object branch anywhere in `count` fetches a wrapper through the cache.
        const count = view.items.count;

        expect(itemsCache.owns('items.old', removed)).toBe(false);
        // Only the keep branch was ever read under items: it is the one entry left standing.
        expect(itemsCache.size()).toEqual(1);
        expect(itemsCache.owns('items.keep', carburetor.getData().items.keep)).toBeTruthy();
        expect(count).toEqual(0);
    });

    test('enumeration-only reads release a deleted branch wrapper', () => {
        const carburetor = new PrimitiveCarburetor(getPrimitiveTree());
        const removed = carburetor.getData().items.old;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        // Mint the 'items.old' entry, plus the 'items.keep' entry that must survive the sweep.
        expect(view.items.old.n).toEqual(1);
        expect(view.items.keep.title).toEqual('kept');

        const itemsCache = cacheOf(view.items);

        carburetor.deleteOld();

        expect(itemsCache.owns('items.old', removed)).toBeTruthy();

        // Reflect.ownKeys drives the ownKeys trap alone. Object.keys and for...in would ALSO
        // fetch each remaining key's property descriptor, and the read proxy's
        // getOwnPropertyDescriptor trap consults the cache for the object-valued 'keep' key
        // already today — so they could not demonstrate the unfixed behavior pinned here.
        const keys = Reflect.ownKeys(view.items);

        expect(itemsCache.owns('items.old', removed)).toBe(false);
        expect(keys).toEqual(['count', 'keep']);
    });

    test("a presence check ('in') releases a deleted branch wrapper", () => {
        const carburetor = new PrimitiveCarburetor(getPrimitiveTree());
        const removed = carburetor.getData().items.old;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        // Mint the 'items.old' entry, plus the 'items.keep' entry that must survive the sweep.
        expect(view.items.old.n).toEqual(1);
        expect(view.items.keep.title).toEqual('kept');

        const itemsCache = cacheOf(view.items);

        carburetor.deleteOld();

        expect(itemsCache.owns('items.old', removed)).toBeTruthy();

        // The presence check records the path and answers from the raw data: the has trap must
        // be the production access that releases the deleted branch.
        const oldPresent = 'old' in view.items;

        expect(oldPresent).toBe(false);
        expect(itemsCache.owns('items.old', removed)).toBe(false);
        expect(itemsCache.owns('items.keep', carburetor.getData().items.keep)).toBeTruthy();
    });

    test('an emptied dictionary releases its deleted branches', () => {
        const carburetor = new EmptiedCarburetor({items: {temp: {n: 1}}});
        const removedTemp = carburetor.getData().items.temp;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect(view.items.temp.n).toEqual(1);

        const itemsCache = cacheOf(view.items);
        expect(itemsCache.owns('items.temp', removedTemp)).toBeTruthy();

        carburetor.deleteTemp();

        expect(itemsCache.owns('items.temp', removedTemp)).toBeTruthy();

        // The only read past the delete enumerates the emptied dictionary.
        const keys = Object.keys(view.items);

        expect(keys).toEqual([]);
        expect(itemsCache.owns('items.temp', removedTemp)).toBe(false);
        expect(itemsCache.size()).toEqual(0);
    });

    test('the introspection hatch itself still triggers no sweep', () => {
        const carburetor = new PrimitiveCarburetor(getPrimitiveTree());
        const removed = carburetor.getData().items.old;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect(view.items.old.n).toEqual(1);

        const itemsCache = cacheOf(view.items);

        carburetor.deleteOld();

        // cacheOf(view.items) evaluates view.items: a root-level branch read that sweeps the
        // ROOT cache only, never the items cache below it.
        expect(cacheOf(view.items).owns('items.old', removed)).toBeTruthy();

        // The hatch is answered before any trap reaches the data, so reading it straight off the
        // items proxy neither records a path nor sweeps the cache.
        const hatch = (view.items as Record<symbol, unknown>)[PROXY_CACHE];

        expect(hatch).toBe(itemsCache);
        expect(itemsCache.owns('items.old', removed)).toBeTruthy();

        // Only a data read consults the items cache: the primitive read releases the branch.
        const count = view.items.count;

        expect(itemsCache.owns('items.old', removed)).toBe(false);
        expect(count).toEqual(0);
    });

    test('a replaced branch is released by a primitive read too', () => {
        const carburetor = new PrimitiveCarburetor(getPrimitiveTree());
        const removed = carburetor.getData().items.old;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        // Mint the 'items.old' entry, plus the 'items.keep' entry that must survive the sweep.
        expect(view.items.old.n).toEqual(1);
        expect(view.items.keep.title).toEqual('kept');

        const itemsCache = cacheOf(view.items);

        carburetor.replaceOld({n: 2});

        // The sweep is lazy until a read consults the items cache.
        expect(itemsCache.owns('items.old', removed)).toBeTruthy();

        const count = view.items.count;

        expect(itemsCache.owns('items.old', removed)).toBe(false);
        // The written path has not been re-read yet, so no fresh entry may stand for it either.
        expect(itemsCache.owns('items.old', carburetor.getData().items.old)).toBe(false);
        expect(count).toEqual(0);
        expect(view.items.old.n).toEqual(2);
    });
});

interface IChurnTree {
    items: Record<string, {title: string}>;
}

const getChurnTree = (): IChurnTree => ({
    items: {keep: {title: 'kept'}},
});

class ChurnCarburetor extends Carburetor<IChurnTree> {
    /** Writes a fresh branch under items through draft and publishes the write. */
    public write = (key: string, title: string): void => {
        this.update((draft: IChurnTree) => {
            draft.items[key] = {title};
        });
    };

    /** Deletes a branch under items through draft and publishes the write. */
    public remove = (key: string): void => {
        this.update((draft: IChurnTree) => {
            delete draft.items[key];
        });
    };
}

describe('the shared invalidation ledger stays bounded (R2-05)', () => {
    test('bounded churn leaves the ledger at live ownership, not lifetime writes', () => {
        const store = new ChurnCarburetor(getChurnTree());
        const reads = new Set<TPath>();
        const view = store.read((path: TPath) => reads.add(path));

        // Mint the one live entry: every churn below leaves it standing.
        expect(view.items.keep.title).toEqual('kept');

        const itemsCache = cacheOf(view.items);

        for (let i = 0; i < 40; i++) {
            const key = 'tmp' + i;
            const title = 't' + i;

            store.write(key, title);
            expect(view.items[key].title).toEqual(title);
            store.remove(key);
            expect(view.items.keep.title).toEqual('kept');
        }

        // Only the live keep entry remains, and every published record has been applied and
        // retired: an append-only ledger would still hold the ~80 records this churn wrote.
        expect(itemsCache.size()).toEqual(1);
        expect(itemsCache.pending()).toEqual(0);

        // Later churn must not rescan or regrow the retired history.
        for (let i = 40; i < 60; i++) {
            const key = 'tmp' + i;
            const title = 't' + i;

            store.write(key, title);
            expect(view.items[key].title).toEqual(title);
            store.remove(key);
            expect(view.items.keep.title).toEqual('kept');
        }

        expect(itemsCache.size()).toEqual(1);
        expect(itemsCache.pending()).toEqual(0);
    });

    test('a record survives until every cache sharing the scope has applied it', () => {
        const carburetor = new PrimitiveCarburetor(getPrimitiveTree());
        const removed = carburetor.getData().items.old;
        const reads1 = new Set<TPath>();
        const reads2 = new Set<TPath>();
        const view1 = carburetor.read((path: TPath) => reads1.add(path));
        const view2 = carburetor.read((path: TPath) => reads2.add(path));

        // Both views mint the items.old entry the write below will obsolete.
        expect(view1.items.old.n).toEqual(1);
        expect(view2.items.old.n).toEqual(1);

        carburetor.replaceOld({n: 2});

        // Published, unretired: nothing has swept the record yet.
        expect(cacheOf(view1.items).pending()).toEqual(1);

        // View 1 re-reads: its own stale entry is released, but the record must survive —
        // view 2 has not consulted its cache since the write, and retirement must never
        // starve a still-active, not-yet-synced cache.
        expect(view1.items.old.n).toEqual(2);
        expect(cacheOf(view1.items).owns('items.old', removed)).toBe(false);
        expect(cacheOf(view1.items).pending()).toEqual(1);
        expect(cacheOf(view2.items).owns('items.old', removed)).toBeTruthy();

        // View 2 finally consults its cache: the surviving record releases its stale entry too.
        expect(view2.items.old.n).toEqual(2);

        expect(cacheOf(view2.items).owns('items.old', removed)).toBe(false);
        expect(cacheOf(view1.items).pending()).toEqual(0);
        expect(cacheOf(view2.items).pending()).toEqual(0);
    });
});

describe('distinct-key churn retires records without waiting for an idle view (R4-07)', () => {
    test('three distinct keys inserted then deleted leave a bounded ledger, not one record per key', () => {
        const store = new ChurnCarburetor(getChurnTree());
        const reads = new Set<TPath>();
        const view = store.read((path: TPath) => reads.add(path));

        // Mint the one entry the idle view holds; it is never consulted again below.
        expect(view.items.keep.title).toEqual('kept');

        const itemsCache = cacheOf(view.items) as IVisitedCache;

        // Three distinct keys, each inserted then deleted: six writes, none of them at a path
        // the idle view's cache has ever held an entry for.
        for (const key of ['x', 'y', 'z']) {
            store.write(key, 't' + key);
            store.remove(key);
        }

        // The unfixed behavior reports one pending record per distinct key (3): the idle view's
        // unrelated 'items.keep' entry made every one of them look necessary forever.
        expect(itemsCache.pending()).toEqual(0);

        // The unfixed behavior visits 1+1+2+2+3+3 = 12 records across these six writes, because
        // each write's cheap retire pass never checks whether the idle view actually needs the
        // growing set of pending records. Bounded here means proportional to the six writes
        // actually made, not to the ledger an unrelated idle view forced to keep growing.
        expect(itemsCache.visitedRecords()).toBeLessThanOrEqual(6);

        // The idle view's own entry is untouched by any of this churn.
        expect(view.items.keep.title).toEqual('kept');
    });
});
