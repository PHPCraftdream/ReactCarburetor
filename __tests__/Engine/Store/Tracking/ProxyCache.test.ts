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
    });

    test('deleting a branch drops it from the view; the sibling wrapper is unaffected', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const view = carburetor.read(() => {});
        const sibling = view.items.b;

        carburetor.deleteA();

        expect(view.items.a).toBeUndefined();
        // The sibling's raw object never changed, so its cached wrapper survives untouched —
        // no release step is needed to make that true, only the object-identity match.
        expect(view.items.b).toBe(sibling);
        expect(view.items.b.title).toEqual('second');
    });

    test("deleting a read branch is reflected in a component's persistent connect() view", () => {
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

        act(() => store.deleteA());

        // The component re-rendered and re-read, so the deletion must have changed what it shows.
        expect(container.querySelector('.title')?.textContent).toEqual('second');

        // captured.items walks the facade onto the live read proxy's items branch.
        const capturedView = captured as TReadonly<ITreeData>;

        expect(capturedView.items.a).toBeUndefined();
        expect(capturedView.items.b.title).toEqual('second');

        unmount();
    });

    test('replacing a branch mints a fresh wrapper; the sibling keeps its identity', () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const view = carburetor.read(() => {});
        const newBranch: IBranch = {title: 'replaced'};

        const oldWrapper = view.items.a;
        const siblingWrapper = view.items.b;

        carburetor.replaceA(newBranch);

        const newWrapper = view.items.a;

        expect(newWrapper).not.toBe(oldWrapper);
        expect(newWrapper.title).toEqual('replaced');
        expect(cacheOf(view.items).owns('items.a', newBranch)).toBe(true);
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

        expect(view.items.b.title).toEqual('second');

        expect(view.items.a).toBe(wrapper);
        expect(cacheOf(view.items).owns('items.a', branchA)).toBe(true);
        expect(view.items.a.title).toEqual('edited');
    });

    test("each recorder gets its own cache, independent of any other view's", () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const view1 = carburetor.read(() => {});
        const view2 = carburetor.read(() => {});

        const a1 = view1.items.a;
        const a2 = view2.items.a;

        // Per-recorder wrappers are the key contract: one recorder's read set can never be
        // satisfied by another's branch wrapper.
        expect(a1).not.toBe(a2);

        carburetor.deleteA();

        // Both views see the deletion independently — neither's cache for the surviving
        // sibling was ever shared with the other's.
        expect(view1.items.a).toBeUndefined();
        expect(view2.items.a).toBeUndefined();
        expect(view1.items.b.title).toEqual('second');
        expect(view2.items.b.title).toEqual('second');
        expect(view1.items.b).not.toBe(view2.items.b);
    });

    test("the draft's write-proxy cache keeps the untouched sibling's wrapper across edits", () => {
        const store = new TreeCarburetor(getTreeData());
        let draftWrapper: unknown = undefined;
        let draftSibling: unknown = undefined;
        let draftSibling2: unknown = undefined;

        store.edit((draft: ITreeData) => {
            draftWrapper = draft.items.a;
            draftSibling = draft.items.b;
        });

        expect(draftWrapper).toBeDefined();

        store.deleteA();

        store.edit((draft: ITreeData) => {
            draftSibling2 = draft.items.b;
        });

        // The untouched sibling keeps its wrapper identity across edits.
        expect(draftSibling2).toBe(draftSibling);
    });

    test("a symbol-keyed write does not disturb branches its own write never touched", () => {
        const carburetor = new TreeCarburetor(getTreeData());
        const view = carburetor.read(() => {});

        const wrapper = view.items.a;

        carburetor.writeTag(1);

        // The symbol write lands on the root object alone; `items` and `items.a` are still
        // the same raw objects they were, so their cached wrappers are still valid — no bulk
        // eviction is needed for correctness, only an object-identity match.
        expect(view.items.a).toBe(wrapper);
        expect(view.items.a.title).toEqual('first');
    });
});

describe('createProxyCache', () => {
    test('a hit reuses the wrapper for the same (path, source)', () => {
        const cache = createProxyCache();
        const x = {name: 'x'};
        const built = {version: 1};

        const first = cache('p.x', x, () => built);
        const second = cache('p.x', x, () => ({version: 2}));

        expect(first).toBe(built);
        expect(second).toBe(built);
        expect(cache.owns('p.x', x)).toBe(true);
    });

    test('the same object read at a different path mints a fresh wrapper', () => {
        const cache = createProxyCache();
        const shared = {name: 'shared'};

        const atA = cache('a', shared, () => ({at: 'a'}));
        const atB = cache('b', shared, () => ({at: 'b'}));

        expect(atB).not.toBe(atA);
        // The cache holds one entry per source: the newer path wins, the older one is gone.
        expect(cache.owns('b', shared)).toBe(true);
        expect(cache.owns('a', shared)).toBe(false);
    });

    test('a different object at the same path always mints fresh, independent of the old one', () => {
        const cache = createProxyCache();
        const before = {name: 'before'};
        const after = {name: 'after'};

        const first = cache('p', before, () => ({gen: 1}));
        const second = cache('p', after, () => ({gen: 2}));

        expect(second).not.toBe(first);
        expect(cache.owns('p', before)).toBe(true);
        expect(cache.owns('p', after)).toBe(true);
    });

    test('two caches are fully independent, even over the same object and path', () => {
        const cacheA = createProxyCache();
        const cacheB = createProxyCache();
        const shared = {name: 'shared'};

        const wrapperA = cacheA('x', shared, () => ({side: 'a'}));
        const wrapperB = cacheB('x', shared, () => ({side: 'b'}));

        expect(wrapperB).not.toBe(wrapperA);
        expect(cacheB('x', shared, () => ({side: 'b2'}))).toBe(wrapperB);
    });

    // A removed branch's cache entry needs no explicit release to prove correct: it lives in
    // a `WeakMap` keyed by the branch's own raw object, so once nothing outside the cache
    // references that object, the entry is collectable by construction. Pinning that down
    // with a `FinalizationRegistry` needs `global.gc()`, which this test runner does not
    // expose (no `--expose-gc`), so it is documented here instead of faked with a timer.
});
