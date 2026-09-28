import {Carburetor, TPath} from "@/Carburetor";
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

const TAG: unique symbol = Symbol('read-proxy-precision-tag');

interface ITaggedData {
    items: IRow[];
    [TAG]?: number;
}

class TaggedCarburetor extends Carburetor<ITaggedData> {
    public tag = (value: number): void => {
        this.update((draft: ITaggedData) => {
            draft[TAG] = value;
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

    test('probing an accessor with `in` does not run it', () => {
        let calls = 0;
        const data = {items: [] as IRow[]};

        Object.defineProperty(data, 'computedTitle', {
            enumerable: true,
            get: (): string => {
                calls++;

                return 'x';
            },
        });

        const carburetor = new ListCarburetor(data);
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect('computedTitle' in view).toBe(true);
        expect(calls).toEqual(0);
        expect(reads.has('computedTitle')).toBe(true);
    });

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

describe('a symbol key records nothing, whether it is the object\'s own or absent (R15-01)', () => {
    test('an own symbol-keyed read records nothing', () => {
        const carburetor = new TaggedCarburetor({items: [{title: 'a'}], [TAG]: 1});
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect(view[TAG]).toEqual(1);
        expect(reads.size).toEqual(0);
        expect(reads.has(WILDCARD_PATH)).toBe(false);
    });

    test('an absent symbol-keyed read records nothing, but a later own-symbol write still wakes the reader', () => {
        const carburetor = new TaggedCarburetor({items: [{title: 'a'}]});
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));
        let wakes = 0;

        expect(view[TAG]).toBeUndefined();
        expect(reads.size).toEqual(0);

        // Nothing was recorded, yet the guarantee still holds: a write through a symbol key
        // collapses to the wildcard on the write side (WriteProxyHandler.writtenPath), and a
        // wildcard write wakes every subscriber regardless of what it read.
        carburetor.subscribe(() => wakes++, {id: 'tag-reader', reads});
        carburetor.tag(5);

        expect(wakes).toEqual(1);
    });

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
