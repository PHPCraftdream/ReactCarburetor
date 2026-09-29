import {Carburetor} from "@/Carburetor";
import {TPath} from "@/Carburetor/Models/Paths";
import {detachSelection} from "@/Carburetor/Component/Connection/detachSelection";
import {sameSelection} from "@/Carburetor/Component/Connection/sameSelection";
import {WILDCARD_PATH} from "@/Carburetor/Store/Paths/WildcardPath";

interface IRow {
    title: string;
}

interface IListData {
    items: IRow[];
    extra?: number;
}

const getListData = (): IListData => ({
    items: [{title: 'a'}, {title: 'b'}, {title: 'c'}],
});

class ListCarburetor extends Carburetor<IListData> {
    public setTitle = (index: number, title: string): void => {
        this.update((draft: IListData) => {
            draft.items[index].title = title;
        });
    };

    public setExtra = (extra: number): void => {
        this.update((draft: IListData) => {
            draft.extra = extra;
        });
    };
}

describe('the has trap over a trackable element records a branch marker, not the whole element', () => {
    test('.map records a branch marker per index, the leaf the callback reads, and skips inherited members', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        view.items.map((row) => row.title);

        expect(reads.has('items.0.~p')).toBe(true);
        expect(reads.has('items.1.~p')).toBe(true);
        expect(reads.has('items.2.~p')).toBe(true);
        expect(reads.has('items.0.title')).toBe(true);

        // The coarse "whole element" path the old `has` trap recorded is gone.
        expect(reads.has('items.0')).toBe(false);
        expect(reads.has('items.1')).toBe(false);

        // Inherited members the algorithm touches along the way name no data of the array's own.
        expect(reads.has('items.map')).toBe(false);
        expect(reads.has('items.constructor')).toBe(false);
    });

    test('a reader that only probes presence through .map is not woken by a write to an untouched leaf', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        // Discards the element: HasProperty and Get both still run per index, but no leaf
        // under any element is ever read.
        view.items.map(() => 0);

        carburetor.subscribe(() => wakes++, {id: 'map-parent', reads});

        carburetor.setTitle(1, 'changed');

        expect(wakes).toEqual(0);
    });

    test('an inherited string key probed with `in` records nothing', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect('map' in view.items).toBe(true);
        expect(reads.has('items.map')).toBe(false);
    });

    // R6-02/R6-03: an accessor is no longer valid state — the constructor now rejects it before
    // `in` (or anything else) ever gets to probe it. See StateModel.test.ts for the rejection
    // and the getter-not-invoked assertion this test used to make here.
    test('an absent key probed with `in` still records, so a later add wakes the reader', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect('extra' in view).toBe(false);
        expect(reads.has('extra')).toBe(true);

        carburetor.subscribe(() => wakes++, {id: 'extra-reader', reads});

        carburetor.setExtra(9);

        expect(wakes).toEqual(1);
    });
});

describe('iterating a tracked array reads the elements it visits, not the wildcard', () => {
    test('for-of over the array records no wildcard', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        const titles: string[] = [];

        for (const row of view.items) {
            titles.push(row.title);
        }

        expect(titles).toEqual(['a', 'b', 'c']);
        expect(reads.has(WILDCARD_PATH)).toBe(false);
    });

    test('spreading the array records no wildcard', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        const copy = [...view.items];

        expect(copy.map((row) => row.title)).toEqual(['a', 'b', 'c']);
        expect(reads.has(WILDCARD_PATH)).toBe(false);
    });

    test('array destructuring records no wildcard', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        const [first] = view.items;

        expect(first.title).toEqual('a');
        expect(reads.has(WILDCARD_PATH)).toBe(false);
    });

    test('Array.from over the array records no wildcard', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        const copy = Array.from(view.items);

        expect(copy.map((row) => row.title)).toEqual(['a', 'b', 'c']);
        expect(reads.has(WILDCARD_PATH)).toBe(false);
    });

    test('a reader that only iterates with for-of is not woken by an unrelated write', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        for (const row of view.items) {
            void row;
        }

        carburetor.subscribe(() => wakes++, {id: 'for-of-reader', reads});

        carburetor.setExtra(1);

        expect(wakes).toEqual(0);
    });

    test('reading an inherited symbol like Symbol.iterator directly records nothing', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        const iterator = (view.items as unknown as {[Symbol.iterator]: unknown})[Symbol.iterator];

        expect(iterator).toBe(Array.prototype[Symbol.iterator]);
        expect(reads.has(WILDCARD_PATH)).toBe(false);
        // Traversing to `items` is still a real, recorded read: only the inherited symbol
        // access itself is free.
        expect(reads.has('items.~p')).toBe(true);
    });
});

// R6-02/R6-03: an own symbol key is no longer valid state (superseded R15-01's own-key half —
// see StateModel.test.ts for the rejection); an absent, inherited symbol still records nothing.
describe('an absent (inherited) symbol key records nothing (R15-01)', () => {
    test('reading Object.prototype.toString.call, concat and String() on live data records no wildcard', () => {
        const carburetor = new ListCarburetor(getListData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        // Each of these reads a well-known, absent symbol: Symbol.toStringTag,
        // Symbol.isConcatSpreadable and Symbol.toPrimitive respectively.
        Object.prototype.toString.call(view);
        view.items.concat([]);
        String(view);

        expect(reads.has(WILDCARD_PATH)).toBe(false);
    });
});

interface IEscaped {
    'a.b': number;
    'a~b': number;
    branch: {n: number};
}

const getEscaped = (): IEscaped => ({'a.b': 1, 'a~b': 2, branch: {n: 3}});

class EscapedCarburetor extends Carburetor<IEscaped> {
    public writeTilde = (v: number): void => {
        this.update((draft: IEscaped): void => {
            draft['a~b'] = v;
        });
    };
}

describe('R15-08: the per-handler path memo records exactly what joinPath/branchPath would', () => {
    test('a repeated read of the same dotted key records the same escaped path every time', () => {
        const carburetor = new EscapedCarburetor(getEscaped());
        const reads: TPath[] = [];
        const view = carburetor.read((path: TPath) => reads.push(path));

        void view['a.b'];
        void view['a.b'];
        void view['a.b'];

        expect(reads).toEqual(['a~1b', 'a~1b', 'a~1b']);
    });

    test('a tilde in a key is escaped to ~0, stays escaped on a repeated read, and still wakes on write', () => {
        const carburetor = new EscapedCarburetor(getEscaped());
        const reads: TPath[] = [];
        const view = carburetor.read((path: TPath) => reads.push(path));
        let wakes = 0;

        void view['a~b'];
        void view['a~b'];

        expect(reads).toEqual(['a~0b', 'a~0b']);

        carburetor.subscribe(() => wakes++, {id: 'tilde-reader', reads: new Set<TPath>(reads)});
        carburetor.writeTilde(9);

        expect(wakes).toEqual(1);
    });

    test('a repeated branch read records the same branch marker every time, and a leaf below it its own path', () => {
        const carburetor = new EscapedCarburetor(getEscaped());
        const reads: TPath[] = [];
        const view = carburetor.read((path: TPath) => reads.push(path));

        void view.branch;
        void view.branch;
        void view.branch.n;

        expect(reads).toEqual(['branch.~p', 'branch.~p', 'branch.~p', 'branch.n']);
    });
});

interface IRowItem {
    title: string;
    done: boolean;
}

interface IRowsData {
    items: Record<string, IRowItem>;
    extra?: number;
}

const getRowsData = (): IRowsData => ({
    items: {
        k1: {title: 'a', done: false},
        k2: {title: 'b', done: true},
        k3: {title: 'c', done: false},
    },
});

class RowsCarburetor extends Carburetor<IRowsData> {
    public setTitle = (id: string, title: string): void => {
        this.update((draft: IRowsData) => {
            draft.items[id].title = title;
        });
    };

    public setDone = (id: string, done: boolean): void => {
        this.update((draft: IRowsData) => {
            draft.items[id].done = done;
        });
    };

    public addItem = (id: string, row: IRowItem): void => {
        this.update((draft: IRowsData) => {
            draft.items[id] = row;
        });
    };

    public deleteItem = (id: string): void => {
        this.update((draft: IRowsData) => {
            delete draft.items[id];
        });
    };

    public replaceItems = (next: Record<string, IRowItem>): void => {
        this.update((draft: IRowsData) => {
            draft.items = next;
        });
    };

    public setExtra = (extra: number): void => {
        this.update((draft: IRowsData) => {
            draft.extra = extra;
        });
    };
}

/**
 * Regression coverage for R16-01: enumerating a branch must subscribe to its key set, not to
 * every leaf under it. Each of these fails on pre-fix code — `ownKeys` recording the branch's
 * own path (or the wildcard at the root) wakes every one of these readers on a title write that
 * changes no key.
 */
describe('R16-01: an enumerator wakes on a key added or removed under it, not on an unrelated leaf write', () => {
    test('Object.keys(items).length wakes on a key added or removed, not on a title write', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.items).length).toEqual(3);
        expect(reads.has('items.~k')).toBe(true);
        expect(reads.has('items')).toBe(false);

        carburetor.subscribe(() => wakes++, {id: 'keys-length', reads});

        carburetor.setTitle('k1', 'renamed');
        expect(wakes).toEqual(0);

        carburetor.addItem('k4', {title: 'd', done: false});
        expect(wakes).toEqual(1);

        carburetor.deleteItem('k4');
        expect(wakes).toEqual(2);
    });

    test('Object.entries(items).length wakes the same way; entries never drills into a leaf', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.entries(view.items).length).toEqual(3);

        carburetor.subscribe(() => wakes++, {id: 'entries-length', reads});

        carburetor.setTitle('k1', 'renamed');
        expect(wakes).toEqual(0);

        carburetor.addItem('k4', {title: 'd', done: false});
        expect(wakes).toEqual(1);
    });

    test('for (k in items) count wakes the same way', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let count = 0;

        for (const _k in view.items) {
            count++;
        }

        expect(count).toEqual(3);

        let wakes = 0;
        carburetor.subscribe(() => wakes++, {id: 'for-in-count', reads});

        carburetor.setTitle('k1', 'renamed');
        expect(wakes).toEqual(0);

        carburetor.deleteItem('k1');
        expect(wakes).toEqual(1);
    });

    test('Object.values(items).filter(t => t.done).length wakes on a read done flip, not an unread title', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        // Reads every item's `done` flag (the filter predicate), but no `title`.
        expect(Object.values(view.items).filter((row) => row.done).length).toEqual(1);
        expect(reads.has('items.k1.done')).toBe(true);
        expect(reads.has('items.k1.title')).toBe(false);

        carburetor.subscribe(() => wakes++, {id: 'values-filter', reads});

        // An unread field: the key set and every read leaf are untouched.
        carburetor.setTitle('k1', 'renamed');
        expect(wakes).toEqual(0);

        // A read leaf changing must still wake this reader.
        carburetor.setDone('k1', true);
        expect(wakes).toEqual(1);

        // A key added or removed must still wake it too.
        carburetor.addItem('k4', {title: 'd', done: false});
        expect(wakes).toEqual(2);
    });

    test('Object.keys(d) at the root wakes on a root key added, not on a write under an existing branch', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view)).toEqual(['items']);
        expect(reads.has('~k')).toBe(true);

        carburetor.subscribe(() => wakes++, {id: 'root-keys', reads});

        carburetor.setTitle('k1', 'renamed');
        expect(wakes).toEqual(0);

        // Adding a key under `items` does not change the root's own key set.
        carburetor.addItem('k4', {title: 'd', done: false});
        expect(wakes).toEqual(0);

        // A root-level key appearing does.
        carburetor.setExtra(1);
        expect(wakes).toEqual(1);
    });

    test('replacing the branch itself still wakes an enumerator, through the ancestor rule', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(Object.keys(view.items).length).toEqual(3);

        carburetor.subscribe(() => wakes++, {id: 'keys-length', reads});

        carburetor.replaceItems({k9: {title: 'z', done: false}});

        expect(wakes).toEqual(1);
    });
});

/**
 * detachSelection and sameSelection both enumerate a live view's branches through `ownKeys`
 * (Reflect.ownKeys on a proxy hits the trap), then read each key's value through `get`. R16-01
 * changes what `ownKeys` records but not what `get` records, so these must still subscribe to
 * every leaf they actually touch.
 */
describe('detachSelection and sameSelection still subscribe to every leaf they copy (R16-01)', () => {
    test('detachSelection records the key-set marker and every leaf it walks', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        const detached = detachSelection(view.items) as Record<string, IRowItem>;

        expect(detached).toEqual({
            k1: {title: 'a', done: false},
            k2: {title: 'b', done: true},
            k3: {title: 'c', done: false},
        });
        expect(reads.has('items.~k')).toBe(true);
        expect(reads.has('items.k1.title')).toBe(true);
        expect(reads.has('items.k1.done')).toBe(true);

        let wakes = 0;
        carburetor.subscribe(() => wakes++, {id: 'detach-reader', reads});

        carburetor.setTitle('k1', 'changed');
        expect(wakes).toEqual(1);
    });

    test('sameSelection re-reads every leaf through the live view and stays precise', () => {
        const carburetor = new RowsCarburetor(getRowsData());
        const previous = detachSelection(carburetor.read(() => undefined).items);
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect(sameSelection(previous, view.items)).toBe(true);
        expect(reads.has('items.k1.title')).toBe(true);

        let wakes = 0;
        carburetor.subscribe(() => wakes++, {id: 'same-selection-reader', reads});

        carburetor.setTitle('k1', 'changed');
        expect(wakes).toEqual(1);
        expect(sameSelection(previous, carburetor.read(() => undefined).items)).toBe(false);
    });
});
