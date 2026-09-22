import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {AntiHookComponent, Carburetor, TPath} from '@/Carburetor';
import {createProxyCache} from '@/Carburetor/Store/Tracking/createProxyCache';
import {IProxyCache, PROXY_CACHE} from '@/Carburetor/Store/Tracking/Models';
import {TReadonly} from '@/Carburetor/Models/Base';

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
});
