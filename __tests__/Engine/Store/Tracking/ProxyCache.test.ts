import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, TPath} from '@/Carburetor';
import {createProxyCache} from '@/Carburetor/Store/Tracking/createProxyCache';
import {IProxyCache, PROXY_CACHE} from '@/Carburetor/Store/Tracking/Models';
import {TReadonly} from '@/Carburetor/Models/Base';

/**
 * The R3-06/R3-07 introspection surface `createProxyCache` attaches but does not export as a
 * type (it stays out of the one-export-per-file layout rule and out of the public `IProxyCache`
 * contract): declared locally here, the same way `cacheOf` below reads the `PROXY_CACHE` hatch
 * through a manual cast rather than an exported type.
 */
interface IProxyCacheHandle extends IProxyCache {
    release: () => void;
    visitedRecords: () => number;
    watcherCount: () => number;
}

interface IBranch {
    title: string;
}

interface ITreeData {
    items: {a: IBranch; b: IBranch};
    list: Array<{n: number}>;
}

const getTreeData = (): ITreeData => ({
    items: {a: {title: 'first'}, b: {title: 'second'}},
    list: [{n: 1}, {n: 2}],
});

// A symbol has no place in a dotted path, so a write through one is the wildcard case.
const TAG: unique symbol = Symbol('proxy-cache-tag');

class TreeCarburetor extends Carburetor<ITreeData> {
    /** Deletes the items.a branch through draft and publishes the write. */
    public deleteA = (): void => {
        this.update((draft: ITreeData) => {
            delete draft.items.a;
        });
    };

    /** Replaces the items.a branch wholesale through draft. */
    public replaceA = (next: IBranch): void => {
        this.update((draft: ITreeData) => {
            draft.items.a = next;
        });
    };

    /** Writes a leaf under items.a through draft. */
    public setATitle = (title: string): void => {
        this.update((draft: ITreeData) => {
            draft.items.a.title = title;
        });
    };

    /** Writes a leaf under the sibling branch items.b through draft. */
    public writeBTitle = (title: string): void => {
        this.update((draft: ITreeData) => {
            draft.items.b.title = title;
        });
    };

    /** Reorders the list array in place through draft. */
    public reverseList = (): void => {
        this.update((draft: ITreeData) => {
            draft.list.reverse();
        });
    };

    /** Runs an arbitrary mutation through draft, for tests that capture values mid-write. */
    public edit = (mutate: (draft: ITreeData) => void): void => {
        this.update(mutate);
    };

    /** Writes through a symbol key, which no path can name. */
    public writeTag = (value: number): void => {
        this.update((draft: ITreeData) => {
            (draft as unknown as {[TAG]?: number})[TAG] = value;
        });
    };
}

/** The cache handle a tracking proxy answers its introspection symbol with. */
const cacheOf = (branch: unknown): IProxyCache =>
    (branch as Record<symbol, IProxyCache>)[PROXY_CACHE];

describe('proxy cache ownership', () => {
    test('a live branch is cached and its wrapper is reused', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const branch = carburetor.getData().items.a;

        const firstRead = view.items.a;
        const secondRead = view.items.a;

        expect(firstRead).toBe(secondRead);
        expect(firstRead.title).toEqual('first');
        expect(cacheOf(view.items).owns('items.a', branch)).toBeTruthy();
        expect(cacheOf(view.items).size()).toEqual(1);
    });

    test('reproduction: deleting a read branch leaves its object held by the live view cache', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const removed = carburetor.getData().items.a;
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        const wrapper = view.items.a;
        const sibling = view.items.b;

        const itemsCache = cacheOf(view.items);
        expect(itemsCache.owns('items.a', removed)).toBeTruthy();

        carburetor.deleteA();

        // The write has landed, but nothing has consulted the cache since: the sweep is lazy,
        // and this assertion pins that laziness down deterministically.
        expect(itemsCache.owns('items.a', removed)).toBeTruthy();

        // Reading ANOTHER path is the production access that must release the deleted branch.
        // No read at items.a happens here, and nothing below depends on garbage collection.
        expect(view.items.b.title).toEqual('second');

        expect(itemsCache.owns('items.a', removed)).toBe(false);
        expect(itemsCache.size()).toEqual(1);
        expect(itemsCache.owns('items.b', carburetor.getData().items.b)).toBeTruthy();

        // The handed-out data follows the write even though the old wrapper was released.
        expect(view.items.a).toBeUndefined();
        expect(view.items.b).toBe(sibling);
        expect(wrapper.title).toEqual('first');
    });

    test("deleting a read branch releases it from a component's persistent connect() view", () => {
        const store = new TreeCarburetor(getTreeData());
        const removed = store.getData().items.a;
        let captured: unknown = undefined;

        class TitleView extends AntiHookComponent {
            private readonly connection = this.connect(() => store);

            public render() {
                const view = this.connection;

                captured = view;

                const title = view.items.a ? view.items.a.title : view.items.b.title;

                return React.createElement('div', {className: 'title'}, title);
            }
        }

        const {container, unmount} = render(React.createElement(TitleView));

        expect(container.querySelector('.title')?.textContent).toEqual('first');

        act(() => store.deleteA());

        // The component re-rendered and re-read, so the deletion must have changed what it shows.
        expect(container.querySelector('.title')?.textContent).toEqual('second');

        // captured.items walks the facade onto the live read proxy's items branch — the proxy
        // whose cache held items.a across the delete.
        const capturedView = captured as TReadonly<ITreeData>;
        const itemsCache = cacheOf(capturedView.items);

        expect(itemsCache.owns('items.a', removed)).toBe(false);
        // The post-delete render read only items.b past the sweep, and that branch entry is the
        // one thing the cache still holds.
        expect(itemsCache.size()).toEqual(1);

        unmount();
    });

    test('replacing a branch releases the old target without another read at that path', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const oldBranch = carburetor.getData().items.a;
        const newBranch: IBranch = {title: 'replaced'};

        const oldWrapper = view.items.a;
        const siblingWrapper = view.items.b;

        carburetor.replaceA(newBranch);

        // The sweep trigger is a read at a DIFFERENT path: releasing items.a must not depend on
        // anything re-reading it.
        expect(view.items.b.title).toEqual('second');

        const itemsCache = cacheOf(view.items);

        expect(itemsCache.owns('items.a', oldBranch)).toBe(false);
        // The written path has not been re-read yet, so no fresh entry may stand for it either.
        expect(itemsCache.owns('items.a', newBranch)).toBe(false);
        expect(itemsCache.size()).toEqual(1);

        const newWrapper = view.items.a;

        expect(newWrapper).not.toBe(oldWrapper);
        expect(newWrapper.title).toEqual('replaced');
        expect(view.items.b).toBe(siblingWrapper);
    });

    test('an array reorder releases stale positions and tracks moved objects at their new paths', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const first = carburetor.getData().list[0];
        const second = carburetor.getData().list[1];

        const firstAtZero = view.list[0];
        const secondAtOne = view.list[1];

        expect(firstAtZero.n).toEqual(1);
        expect(secondAtOne.n).toEqual(2);

        carburetor.reverseList();

        // Only the reads after the reorder count: the recorded paths must name where the data
        // lives NOW, not where it used to live.
        reads.clear();

        expect(view.list[0].n).toEqual(2);
        expect(view.list[1].n).toEqual(1);

        expect(reads.has('list.0.n')).toBe(true);
        expect(reads.has('list.1.n')).toBe(true);

        expect(view.list[0]).not.toBe(firstAtZero);

        const listCache = cacheOf(view.list);

        expect(listCache.owns('list.0', first)).toBe(false);
        expect(listCache.owns('list.1', second)).toBe(false);
        expect(listCache.owns('list.0', second)).toBe(true);
        expect(listCache.owns('list.1', first)).toBe(true);
    });

    test('unrelated and no-op writes keep the current wrappers', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const branchA = carburetor.getData().items.a;

        const wrapper = view.items.a;

        carburetor.writeBTitle('changed');

        // The read-back is itself the sweep the unrelated write published into.
        expect(view.items.a).toBe(wrapper);
        expect(cacheOf(view.items).owns('items.a', branchA)).toBe(true);

        // Same value as the data already holds: the no-change early return must publish nothing.
        carburetor.setATitle('first');

        expect(view.items.a).toBe(wrapper);
        expect(cacheOf(view.items).owns('items.a', branchA)).toBe(true);
    });

    test('a leaf write does not reclaim the branch wrapper it lands under', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const branchA = carburetor.getData().items.a;

        const wrapper = view.items.a;

        carburetor.setATitle('edited');

        // The sweep runs through the sibling branch, never through the written path itself.
        expect(view.items.b.title).toEqual('second');

        expect(view.items.a).toBe(wrapper);
        expect(cacheOf(view.items).owns('items.a', branchA)).toBe(true);
        expect(view.items.a.title).toEqual('edited');
    });

    test("each recorder's view owns its cache entries independently", () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const removedA = carburetor.getData().items.a;
        const reads1 = new Set<TPath>();
        const reads2 = new Set<TPath>();
        const view1 = carburetor.read((path: TPath) => reads1.add(path));
        const view2 = carburetor.read((path: TPath) => reads2.add(path));

        const a1 = view1.items.a;
        const a2 = view2.items.a;

        // Per-recorder wrappers are the key contract: one recorder's read set can never be
        // satisfied by another's branch wrapper.
        expect(a1).not.toBe(a2);

        carburetor.deleteA();

        // Reading through view1 sweeps view1's cache only — view2 has not been consulted.
        expect(view1.items.b.title).toEqual('second');

        expect(cacheOf(view1.items).owns('items.a', removedA)).toBe(false);
        expect(cacheOf(view2.items).owns('items.a', removedA)).toBe(true);

        // Eviction is keyed by written paths, never by anyone's read set: view2 releases the
        // same entry only when something consults ITS cache.
        expect(view2.items.b.title).toEqual('second');
        expect(cacheOf(view2.items).owns('items.a', removedA)).toBe(false);
    });

    test("the draft's write-proxy cache releases replaced branches too", () => {
        const store = new TreeCarburetor(getTreeData());
        const removedA = store.getData().items.a;
        let draftWrapper: unknown = undefined;
        let draftSibling: unknown = undefined;
        let draftCache: unknown = undefined;
        let draftSibling2: unknown = undefined;

        store.edit((draft: ITreeData) => {
            draftWrapper = draft.items.a;
            draftSibling = draft.items.b;
        });

        expect(draftWrapper).toBeDefined();

        store.deleteA();

        store.edit((draft: ITreeData) => {
            draftCache = cacheOf(draft.items);
            draftSibling2 = draft.items.b;
        });

        const cache = draftCache as IProxyCache;

        expect(cache.owns('items.a', removedA)).toBe(false);
        expect(cache.size()).toEqual(1);
        // The untouched sibling keeps its wrapper identity across edits.
        expect(draftSibling2).toBe(draftSibling);
    });

    test('a write under a symbol key invalidates the whole scope', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const itemsObject = carburetor.getData().items;

        const wrapper = view.items.a;

        carburetor.writeTag(1);

        // A root-level read is the sweep trigger: the wildcard invalidation covers every entry
        // the root cache holds, 'items' and 'list' alike.
        expect(view.list[0].n).toEqual(1);

        expect(cacheOf(view).owns('items', itemsObject)).toBe(false);
        expect(view.items.a).not.toBe(wrapper);
    });
});

describe('createProxyCache', () => {
    test('the cache evicts a path and its descendants, keeping unrelated entries', () => {
        const cache = createProxyCache({});
        const x = {name: 'x'};
        const y = {name: 'y'};
        const qObj = {name: 'q'};
        const xWrapper = {version: 1};

        cache('p.x', x, () => xWrapper);
        cache('p.x.y', y, () => ({version: 2}));
        cache('q', qObj, () => ({version: 3}));

        cache.invalidate('p.x');

        // Lazy: the published invalidation has swept nothing while nobody consulted the cache.
        expect(cache.owns('p.x', x)).toBe(true);
        expect(cache.owns('p.x.y', y)).toBe(true);

        const reRead = cache('p.x', x, () => ({version: 4}));

        expect(reRead).not.toBe(xWrapper);
        expect(cache.owns('p.x', x)).toBe(true);
        expect(cache.owns('p.x.y', y)).toBe(false);
        expect(cache.owns('q', qObj)).toBe(true);
    });

    test('an entry minted after its path was invalidated survives the sweep', () => {
        const cache = createProxyCache({});
        const c = {name: 'c'};

        cache.invalidate('p');

        const fresh = cache('p.c', c, () => ({version: 1}));

        // The revision stamp protects the entry: a sweep never evicts what it postdates.
        expect(cache('p.c', c, () => ({version: 2}))).toBe(fresh);
    });

    test("scopes are per raw object, so one object's invalidation never touches another's cache", () => {
        const objA = {name: 'a'};
        const objB = {name: 'b'};
        const cacheA = createProxyCache(objA);
        const cacheB = createProxyCache(objB);
        const shared = {name: 'shared'};

        cacheA('x', shared, () => ({side: 'a'}));
        const wrapperB = cacheB('x', shared, () => ({side: 'b'}));

        cacheA.invalidate('x');

        // Same path, same source — but a different raw object's scope: the lookup must hand back
        // exactly what it first minted.
        expect(cacheB('x', shared, () => ({side: 'b2'}))).toBe(wrapperB);
    });

    test('a record is kept until every cache sharing the scope has applied it', () => {
        const target = {};
        const cacheA = createProxyCache(target);
        const cacheB = createProxyCache(target);
        const o1 = {name: 'p'};
        const o2 = {name: 'q'};
        const originalB = cacheB('p', o1, () => ({side: 'b'}));

        cacheA('p', o1, () => ({side: 'a'}));

        cacheA.invalidate('p');

        // A read at another path sweeps cacheA — the engine's release-without-rereading behavior.
        cacheA('q', o2, () => ({side: 'a2'}));

        // cacheB never consulted its cache since the write, so the record must survive cacheA's
        // sweep: retiring it now would leave cacheB's stale entry unreleased forever.
        expect(cacheA.pending()).toEqual(1);

        // The surviving record still evicts cacheB's stale entry the moment cacheB is consulted.
        const fresh = cacheB('p', o1, () => ({fresh: true}));

        expect(fresh).not.toBe(originalB);
        expect(cacheB.pending()).toEqual(0);
    });

    test('a record retires once no cache holds an entry it could evict', () => {
        const target = {};
        const cacheA = createProxyCache(target);
        const cacheB = createProxyCache(target);
        const o1 = {name: 'p'};
        const o2 = {name: 'q'};
        const o3 = {name: 'r'};
        const originalQ = cacheB('q', o2, () => ({side: 'b'}));

        cacheA('p', o1, () => ({side: 'a'}));

        cacheA.invalidate('p');

        // A read at another path sweeps cacheA and drops the entry the record covers.
        cacheA('r', o3, () => ({side: 'r'}));

        // cacheB was never synced since the write, but it holds no entry 'p' covers: the record
        // must retire anyway, or the ledger would grow with writes no live entry answers to.
        expect(cacheA.pending()).toEqual(0);

        // Nothing evicted cacheB's unrelated entry: it still answers with its first wrapper.
        expect(cacheB('q', o2, () => ({side: 'b2'}))).toBe(originalQ);
    });

    test('a wildcard record retires like any other once applied', () => {
        const cache = createProxyCache({});
        const p = {name: 'p'};
        const q = {name: 'q'};

        cache('p', p, () => ({version: 1}));

        // The wildcard path: a symbol write cannot be attributed to a dotted path, so the
        // engine publishes '*' and every entry under the scope is obsolete.
        cache.invalidate('*');

        cache('q', q, () => ({version: 2}));

        expect(cache.owns('p', p)).toBe(false);
        expect(cache.pending()).toEqual(0);
    });
});

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

describe('structural mutation is rejected at every read-proxy level (R2-12)', () => {
    test('the root view refuses a prototype change and an extension change', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const raw = carburetor.getData();

        // Without traps of their own, setPrototypeOf and preventExtensions would land straight
        // on the raw backing object the read proxy fronts.
        expect(() => {
            Object.setPrototypeOf(view, null);
        }).toThrow(/read-only/);
        expect(Object.getPrototypeOf(raw)).toBe(Object.prototype);

        expect(() => {
            Object.preventExtensions(view);
        }).toThrow(/read-only/);
        expect(Object.isExtensible(raw)).toBe(true);
    });

    test('a nested branch view refuses them too, and reads and writes keep working afterwards', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const rawBranch = carburetor.getData().items.a;

        const nested = view.items.a;

        // Every level of the read tree is a read proxy, so the nested branch refuses exactly
        // like the root does — against the raw object it fronts, not some copy.
        expect(() => {
            Object.setPrototypeOf(nested, null);
        }).toThrow(/read-only/);
        expect(Object.getPrototypeOf(rawBranch)).toBe(Object.prototype);

        expect(() => {
            Object.preventExtensions(nested);
        }).toThrow(/read-only/);
        expect(Object.isExtensible(rawBranch)).toBe(true);

        // Nothing the refused attempts would have changed survived: the view still answers
        // from the same live data.
        expect(view.items.a.title).toEqual('first');

        carburetor.setATitle('edited');

        // A normal draft write still reaches the view, so the rejections poisoned nothing.
        expect(view.items.a.title).toEqual('edited');
    });

    test('a refused structural mutation never poisons a component view', () => {
        const store = new TreeCarburetor(getTreeData());
        let captured: unknown = undefined;

        class TitleView extends AntiHookComponent {
            private readonly connection = this.connect(() => store);

            public render() {
                const view = this.connection;

                captured = view;

                const title = view.items.a ? view.items.a.title : view.items.b.title;

                return React.createElement('div', {className: 'title'}, title);
            }
        }

        const {container, unmount} = render(React.createElement(TitleView));

        expect(container.querySelector('.title')?.textContent).toEqual('first');

        // The facade forwards every get onto the read proxies below it, so captured.items is
        // the nested read proxy over the raw items object — the level the facade alone misses.
        const nested = (captured as TReadonly<ITreeData>).items;
        const rawItems = store.getData().items;

        expect(() => {
            Object.setPrototypeOf(nested, null);
        }).toThrow(/read-only/);
        expect(Object.getPrototypeOf(rawItems)).toBe(Object.prototype);

        expect(() => {
            Object.preventExtensions(nested);
        }).toThrow(/read-only/);
        expect(Object.isExtensible(rawItems)).toBe(true);

        act(() => store.setATitle('edited'));

        // The component re-rendered and re-read, so the write still reaches it.
        expect(container.querySelector('.title')?.textContent).toEqual('edited');

        unmount();
    });
});

describe('same-path writes coalesce in the invalidation ledger (R3-06)', () => {
    test('five writes to one path an idle view holds leave one record, not five', () => {
        const target = {};
        const idle = createProxyCache(target) as IProxyCacheHandle;
        const writer = createProxyCache(target) as IProxyCacheHandle;
        const o = {name: 'p'};

        // Mints the one live entry an idle view holds; it is never consulted again below.
        idle('p', o, () => ({side: 'idle'}));

        for (let i = 0; i < 5; i++) {
            writer.invalidate('p');
        }

        // An append-only worklist would report one record per write (5), because the idle
        // view's stale entry makes every one of them look necessary until it is consulted.
        expect(writer.pending()).toEqual(1);

        // Each write's retire pass should scan the one coalesced record it actually needs to,
        // not an ever-growing history: an append-only ledger visits 1+2+3+4+5 = 15 records
        // over the same five writes, not 5.
        expect(writer.visitedRecords()).toEqual(5);
    });
});

describe('watcher slots release explicitly, independent of GC timing (R3-07)', () => {
    test('release() keeps the watcher ledger from growing across discarded read-only views', () => {
        const target = {};

        for (let i = 0; i < 25; i++) {
            const view = createProxyCache(target) as IProxyCacheHandle;

            view.release();
        }

        // None of the 25 discarded views needs to have actually been garbage collected here:
        // release() drops each watcher slot immediately and unconditionally, so only the
        // still-alive probe below counts.
        const probe = createProxyCache(target) as IProxyCacheHandle;

        expect(probe.watcherCount()).toEqual(1);
    });
});

describe("connect()/connectSelection() release their watcher on unmount (R3-07 wiring)", () => {
    test("mounting and unmounting a connect() view ten times leaves the store's watcher count bounded", () => {
        const store = new TreeCarburetor(getTreeData());

        class TitleView extends AntiHookComponent {
            private readonly connection = this.connect(() => store);

            public render() {
                const view = this.connection;
                const title = view.items.a ? view.items.a.title : view.items.b.title;

                return React.createElement('div', {className: 'title'}, title);
            }
        }

        for (let i = 0; i < 10; i++) {
            const {unmount} = render(React.createElement(TitleView));

            unmount();
        }

        // A fresh read through the raw store is the same probe the existing R3-07 unit test
        // above uses: it adds exactly one watcher of its own, so a bounded total here proves the
        // ten real mount/unmount cycles through the public connect() API left none of their own
        // behind, without relying on garbage collection to have run by now.
        const probe = store.read(() => {});
        const probeCache = cacheOf(probe) as IProxyCacheHandle;

        expect(probeCache.watcherCount()).toEqual(1);
    });

    test('mounting and unmounting a connectSelection() view ten times leaves the watcher count bounded', () => {
        const store = new TreeCarburetor(getTreeData());

        class Row extends AntiHookComponent {
            private readonly row = this.connectSelection(() => store, (data) => ({title: data.items.a.title}));

            public render() {
                return React.createElement('div', {className: 'title'}, this.row().title);
            }
        }

        for (let i = 0; i < 10; i++) {
            const {unmount} = render(React.createElement(Row));

            unmount();
        }

        const probe = store.read(() => {});
        const probeCache = cacheOf(probe) as IProxyCacheHandle;

        expect(probeCache.watcherCount()).toEqual(1);
    });

    test("a still-mounted component's connect() view is never released out from under it", () => {
        const store = new TreeCarburetor(getTreeData());

        class TitleView extends AntiHookComponent {
            private readonly connection = this.connect(() => store);

            public render() {
                const view = this.connection;
                const title = view.items.a ? view.items.a.title : view.items.b.title;

                return React.createElement('div', {className: 'title'}, title);
            }
        }

        const {container, unmount} = render(React.createElement(TitleView));

        expect(container.querySelector('.title')?.textContent).toEqual('first');

        // Several writes and re-renders while still mounted: componentWillUnmount never ran, so
        // releaseConnectionViews() never ran either — a premature release would either throw on
        // the next read or serve stale data, and neither happens here.
        for (let i = 0; i < 5; i++) {
            const title = 'edited' + i;

            act(() => store.setATitle(title));
            expect(container.querySelector('.title')?.textContent).toEqual(title);
        }

        act(() => store.deleteA());
        expect(container.querySelector('.title')?.textContent).toEqual('second');

        const probe = store.read(() => {});
        const probeCache = cacheOf(probe) as IProxyCacheHandle;

        // The still-mounted view's own watcher is still live in the scope, plus the write
        // proxy's own watcher — created once, lazily, on the first draft access above, and kept
        // for the store's whole lifetime regardless of how many writes follow — and the probe's
        // own slot on top of both. Three, not two, but still bounded: none of the five writes
        // above grew it further, and the still-mounted view's slot in particular was never
        // dropped while still in use.
        expect(probeCache.watcherCount()).toEqual(3);

        unmount();
    });
});

describe('a replayed unmount/mount pair does not strand a later cache (R4-05, R4-09)', () => {
    test('a real unmount releases the cache built after a StrictMode-replayed remount and a root replacement', () => {
        const store = new TreeCarburetor(getTreeData());

        class TitleView extends AntiHookComponent {
            private readonly connection = this.connect(() => store);

            public render() {
                const view = this.connection;
                const title = view.items.a ? view.items.a.title : view.items.b.title;

                return React.createElement('div', {className: 'title'}, title);
            }
        }

        const ref = React.createRef<TitleView>();
        const {container, unmount} = render(React.createElement(TitleView, {ref}));

        expect(container.querySelector('.title')?.textContent).toEqual('first');

        const instance = ref.current as TitleView;

        // A StrictMode replay: componentWillUnmount then componentDidMount on the SAME
        // instance, with no fresh render behind either — invoked directly so the sequence is
        // deterministic rather than depending on React's own StrictMode timing (only fires at
        // initial mount, and does not itself insert a root replacement in between).
        act(() => {
            instance.componentWillUnmount();
            instance.componentDidMount();
        });

        // A root data replacement: buildPersistentView's resolveView() notices the new data
        // object the next time the still-mounted component reads its view (the replayed
        // componentDidMount's restored subscription forces that render) and mints a fresh
        // cache — a second watcher this component now owns.
        act(() => {
            store.setData(getTreeData());
        });

        expect(container.querySelector('.title')?.textContent).toEqual('first');

        const rootAfterReplacement = store.getData();

        unmount();

        // A fresh probe on the SAME (replaced) root: bounded at 1 proves the real unmount
        // released the new cache's watcher. Before the fix, releaseConnectionViews() read from
        // a `connectionViews` list the replay's earlier (first) unmount had already emptied —
        // with nothing to repopulate it before this real unmount — so the post-replacement
        // cache leaked and this probe would have reported 2.
        const probe = store.read(() => {});
        const probeCache = cacheOf(probe) as IProxyCacheHandle;

        expect(store.getData()).toBe(rootAfterReplacement);
        expect(probeCache.watcherCount()).toEqual(1);
    });

    test('unmounting a connection that was declared but never read costs it zero reads and ' +
        'zero extra resolver calls', () => {
        const store = new TreeCarburetor(getTreeData());
        let resolverCalls = 0;
        let readCalls = 0;

        const originalRead = store.read;

        store.read = ((record) => {
            readCalls++;

            return originalRead(record);
        }) as typeof store.read;

        const resolveSource = (): TreeCarburetor => {
            resolverCalls++;

            return store;
        };

        class UnusedConnection extends AntiHookComponent {
            private readonly unused = this.connect(resolveSource);

            public render() {
                // Declared, never touched: exactly the shape R4-09 targets.
                void this.unused;

                return React.createElement('div', {className: 'marker'}, 'ok');
            }
        }

        const {container, unmount} = render(React.createElement(UnusedConnection));

        expect(container.querySelector('.marker')?.textContent).toEqual('ok');

        // The declare-time shape probe (buildPersistentView, at the field initializer) is the
        // only resolver call a mount that never reads the view may cost; the view's own read()
        // proxy is never minted at all.
        const resolverCallsAtMount = resolverCalls;
        const readCallsAtMount = readCalls;

        expect(readCallsAtMount).toEqual(0);

        unmount();

        // Before the fix, releaseConnectionViews() reached the facade's PROXY_CACHE hatch
        // unconditionally, which forwarded through resolveView() — resolving the source again
        // and minting a read proxy from scratch just to immediately release it.
        expect(resolverCalls).toEqual(resolverCallsAtMount);
        expect(readCalls).toEqual(readCallsAtMount);
    });
});

describe('WeakRef is a stated runtime dependency, not a silent one (R3-08)', () => {
    test('the engine requires a global WeakRef and package.json states the runtime floor', () => {
        expect(typeof WeakRef).toBe('function');
        expect(() => createProxyCache({})).not.toThrow();

        const packageJsonPath = path.join(__dirname, '..', '..', '..', '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            engines?: {node?: string};
        };

        // WeakRef shipped unflagged in V8 8.4 / Node 14.6.0: the floor below that throws
        // "WeakRef is not a constructor" on the very first tracked read.
        expect(packageJson.engines?.node).toBe('>=14.6.0');
    });
});
