import * as fs from 'node:fs';
import * as path from 'node:path';
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

interface IProxyCacheHandle extends IProxyCache {
    release: () => void;
    visitedRecords: () => number;
    watcherCount: () => number;
}

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

describe("repeated read() calls do not grow the watcher set without bound (R4-08)", () => {
    test('N repeated read() calls with no writes leave a bounded watcher count', () => {
        const store = new TreeCarburetor(getTreeData());

        // Fifty throwaway read() views, exactly the public API path useCarburetor() drives on
        // every render: none of them ever reads a single property, so none of them can ever
        // need a retirement record either.
        for (let i = 0; i < 50; i++) {
            store.read(() => {});
        }

        const probe = store.read(() => {});
        const probeCache = cacheOf(probe) as IProxyCacheHandle;

        // The unfixed behavior grows the watcher set by one per read() call regardless of GC
        // timing, reporting 51 here. A bounded registration policy reclaims an empty watcher's
        // slot the moment nothing protects it, without waiting for the engine to collect it.
        expect(probeCache.watcherCount()).toEqual(1);
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

describe('a missing browser WeakRef fails with a named, actionable error (R4-10)', () => {
    test('createProxyCache throws a clear message instead of the opaque native TypeError', () => {
        const realWeakRef = globalThis.WeakRef;

        // Simulates a browser without WeakRef: the property is deleted, not just shadowed, so
        // the engine's own `typeof WeakRef === 'undefined'` guard sees exactly what a genuinely
        // unsupported environment would.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).WeakRef;

        try {
            expect(() => createProxyCache({})).toThrow(
                /WeakRef.*requires|requires.*WeakRef/is
            );
            // Names an actionable fix, not just the missing symbol: the unfixed behavior is the
            // engine's own bare "WeakRef is not a constructor", which names neither cause nor fix.
            expect(() => createProxyCache({})).toThrow(/caniuse|browser/i);
        } finally {
            globalThis.WeakRef = realWeakRef;
        }

        // Restored: every other test in this file relies on a working WeakRef.
        expect(() => createProxyCache({})).not.toThrow();
    });

    test('README states the browser WeakRef requirement explicitly', () => {
        const readmePath = path.join(__dirname, '..', '..', '..', '..', 'README.md');
        const readme = fs.readFileSync(readmePath, 'utf8');

        expect(readme).toMatch(/WeakRef/);
        expect(readme).toMatch(/caniuse|MDN/i);
    });
});
