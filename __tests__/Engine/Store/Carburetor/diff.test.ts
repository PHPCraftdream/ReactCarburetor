import {Carburetor, computed} from "@/Carburetor";
import {TPath} from "@/Carburetor/Models/Paths";
import {getTestData, IItemListData, ItemListCarburetor, ITestData, readsOf, TestCarburetor} from "./fixtures";

interface IDictData {
    items: Record<string, {title: string; done: boolean}>;
}

const getDictData = (): IDictData => ({
    items: {a: {title: 'a', done: false}, b: {title: 'b', done: true}},
});

class DictCarburetor extends Carburetor<IDictData> {
    public setTitle = (id: string, title: string): void => {
        this.update((draft: IDictData) => {
            draft.items[id].title = title;
        });
    };
}

/** A store whose root can be swapped for a value of any shape, for the kind-change fallback. */
class FlexCarburetor extends Carburetor<object> {
}

describe('setData (R16-02)', () => {
    test('getData() === data still holds after setData', () => {
        const carburetor = new TestCarburetor(getTestData());
        const next = getTestData();

        expect(carburetor.setData(next)).toBe(next);
        expect(carburetor.getData()).toBe(next);
    });

    test('an identical deep copy wakes nobody and does not bump the version', () => {
        const carburetor = new TestCarburetor(getTestData());
        const versionBefore = carburetor.getVersion();
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher'});
        carburetor.setData(getTestData());

        expect(calls).toEqual(0);
        expect(carburetor.getVersion()).toEqual(versionBefore);
    });

    test('one changed field wakes only its reader, not a sibling', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        const next = getTestData();
        next.a = 5;
        carburetor.setData(next);

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('a changed key set wakes an enumerating reader; a value-only change does not', () => {
        const carburetor = new DictCarburetor(getDictData());
        const reads = new Set<TPath>();
        const view = carburetor.read((path: TPath) => reads.add(path));

        expect(Object.keys(view.items)).toEqual(['a', 'b']);

        let enumeratorWakes = 0;
        carburetor.subscribe(() => enumeratorWakes++, {id: 'enumerator', reads});

        const sameKeys = getDictData();
        sameKeys.items.a.title = 'changed';
        carburetor.setData(sameKeys);
        expect(enumeratorWakes).toEqual(0);

        const addedKey = getDictData();
        addedKey.items.c = {title: 'c', done: false};
        carburetor.setData(addedKey);
        expect(enumeratorWakes).toEqual(1);
    });

    test('a root of another kind (object to array) wakes everyone', () => {
        const carburetor = new FlexCarburetor({a: 1});
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher', reads: readsOf('a')});
        carburetor.setData([1, 2, 3] as unknown as object);

        expect(calls).toEqual(1);
        expect(carburetor.getData()).toEqual([1, 2, 3]);
    });

    test('a non-trackable root wakes everyone', () => {
        const carburetor = new FlexCarburetor(new Map([['a', 1]]));
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'unrelated', reads: readsOf('never-written')});
        carburetor.setData(new Map([['a', 2]]));

        expect(calls).toEqual(1);
    });

    test('past DIFF_PATH_THRESHOLD differing leaves, the write records precise root keys', () => {
        const makeBig = (offset: number): Record<string, number> => {
            const result: Record<string, number> = {};

            for (let i = 0; i < 2500; i++) {
                result['k' + i] = i + offset;
            }

            return result;
        };

        const carburetor = new FlexCarburetor(makeBig(0));
        let unrelatedWakes = 0;

        carburetor.subscribe(() => unrelatedWakes++, {id: 'unrelated', reads: readsOf('never-written')});
        carburetor.setData(makeBig(1));

        // Every root key differs: fallback remains precise at the same-kind root's top-level keys.
        expect(unrelatedWakes).toEqual(0);
    });
});

describe('restore (R16-02)', () => {
    test('does not adopt or mutate the caller\'s snapshot', () => {
        const carburetor = new TestCarburetor(getTestData());
        const snapshot = getTestData();
        snapshot.a = 9;

        carburetor.restore(snapshot);
        carburetor.setA(1);

        // If restore had adopted `snapshot` by reference, this write would show up on it too.
        expect(snapshot.a).toEqual(9);
        expect(carburetor.getData()).not.toBe(snapshot);
    });

    test('an untouched branch keeps its object identity', () => {
        const carburetor = new TestCarburetor(getTestData());
        const nestedBefore = carburetor.getData().nested;

        const snapshot = getTestData();
        snapshot.a = 7;

        carburetor.restore(snapshot);

        expect(carburetor.getData().a).toEqual(7);
        expect(carburetor.getData().nested).toBe(nestedBefore);
    });

    test('wakes only the reader of what changed, not a sibling', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        const snapshot = getTestData();
        snapshot.a = 3;
        carburetor.restore(snapshot);

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('a root of another kind falls back to a wholesale, wildcard swap', () => {
        const carburetor = new FlexCarburetor({a: 1});
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher'});
        carburetor.restore([1, 2, 3] as unknown as object);

        expect(calls).toEqual(1);
        expect(carburetor.getData()).toEqual([1, 2, 3]);
    });

    // R6-02/R6-03: an own symbol key is no longer valid state — restore() now rejects it at the
    // boundary instead of diffing around it. See StateModel.test.ts for the rejection.


    // R6-01: a snapshot that only grew via trailing holes leaves no new own index for
    // applyBranch's key loops to see, so without a length write of its own the live array kept
    // its old length, the version never moved, and a subscriber reading only the length was
    // never woken.
    describe('array length growth (R6-01)', () => {
        test('grows a root array made only of trailing holes, bumps the version and wakes a length reader', () => {
            const carburetor = new FlexCarburetor([1] as unknown as object);
            let calls = 0;

            carburetor.subscribe(() => calls++, {id: 'length-reader', reads: readsOf('length')});
            const versionBefore = carburetor.getVersion();

            const snapshot: unknown[] = [1];
            snapshot.length = 3; // indices 1 and 2 stay holes; no new own key appears

            carburetor.restore(snapshot as unknown as object);

            expect((carburetor.getData() as unknown as unknown[]).length).toEqual(3);
            expect(carburetor.getVersion()).toEqual(versionBefore + 1);
            expect(calls).toEqual(1);
        });

        test('grows a root array through real appended values, same as the hole-only case', () => {
            const carburetor = new FlexCarburetor([1] as unknown as object);
            let calls = 0;

            carburetor.subscribe(() => calls++, {id: 'length-reader', reads: readsOf('length')});

            carburetor.restore([1, 2, 3] as unknown as object);

            expect((carburetor.getData() as unknown as unknown[]).length).toEqual(3);
            expect(calls).toEqual(1);
        });

        test('still shrinks a root array and wakes a length reader (regression)', () => {
            const carburetor = new FlexCarburetor([1, 2, 3] as unknown as object);
            let calls = 0;

            carburetor.subscribe(() => calls++, {id: 'length-reader', reads: readsOf('length')});

            carburetor.restore([1] as unknown as object);

            expect((carburetor.getData() as unknown as unknown[]).length).toEqual(1);
            expect(calls).toEqual(1);
        });

        test('grows a nested array made only of trailing holes and wakes its length reader', () => {
            const carburetor = new ItemListCarburetor({items: [{n: 1}]});
            let calls = 0;

            carburetor.subscribe(() => calls++, {id: 'length-reader', reads: readsOf('items.length')});
            const versionBefore = carburetor.getVersion();

            const snapshot: IItemListData = {items: [{n: 1}]};
            snapshot.items.length = 3;

            carburetor.restore(snapshot);

            expect(carburetor.getData().items.length).toEqual(3);
            expect(carburetor.getVersion()).toEqual(versionBefore + 1);
            expect(calls).toEqual(1);
        });

        test('still shrinks a nested array and wakes its length reader (regression)', () => {
            const carburetor = new ItemListCarburetor({items: [{n: 1}, {n: 2}, {n: 3}]});
            let calls = 0;

            carburetor.subscribe(() => calls++, {id: 'length-reader', reads: readsOf('items.length')});

            carburetor.restore({items: [{n: 1}]});

            expect(carburetor.getData().items.length).toEqual(1);
            expect(calls).toEqual(1);
        });
    });
});

describe('fromJSON adopts its argument (R16-09)', () => {
    test('getData() answers the exact object handed to fromJSON', () => {
        const carburetor = new TestCarburetor(getTestData());
        const parsed = getTestData();
        parsed.a = 4;

        carburetor.fromJSON(parsed);

        expect(carburetor.getData()).toBe(parsed);
    });

    test('restore, by contrast, never adopts its argument', () => {
        const carburetor = new TestCarburetor(getTestData());
        const snapshot = getTestData();

        carburetor.restore(snapshot);

        expect(carburetor.getData()).not.toBe(snapshot);
    });
});

/**
 * R6-02/R6-03: state is own enumerable string-keyed data — a container's `Object.keys` and
 * (for an array) its elements and `length`. Anything else at the boundary (constructor,
 * setData, restore) throws in development rather than corrupting tracking silently (R6-02) or
 * losing data on a round trip (the R5-05/R3-05 symbol-support surface this replaces).
 */
describe('state model (R6-02/R6-03)', () => {
    test('a non-enumerable own property is rejected at construction, root and nested, naming the path', () => {
        const rootBad: Record<string, unknown> = {a: 1};
        Object.defineProperty(rootBad, 'hidden', {value: 2, enumerable: false, configurable: true, writable: true});

        expect(() => new Carburetor(rootBad)).toThrow('non-enumerable');
        expect(() => new Carburetor(rootBad)).toThrow('hidden');

        const nestedBad: {box: Record<string, unknown>} = {box: {}};
        Object.defineProperty(
            nestedBad.box, 'hidden', {value: 2, enumerable: false, configurable: true, writable: true}
        );

        expect(() => new Carburetor(nestedBad)).toThrow('box.hidden');
    });

    // A getter is rejected the same way, without ever being invoked: see read-view.test.ts.
    test('an own symbol key is rejected at construction, root and nested, without ever being state', () => {
        const tag = Symbol('tag');

        expect(() => new Carburetor({a: 1, [tag]: 2})).toThrow('symbol');
        expect(() => new Carburetor({box: {a: 1, [tag]: 2}})).toThrow('symbol');
    });

    test('a non-index own key on an array is rejected at construction', () => {
        const rows: number[] = [1, 2, 3];
        (rows as unknown as Record<string, unknown>).meta = 'x';

        expect(() => new Carburetor({rows})).toThrow('non-index');
        expect(() => new Carburetor({rows})).toThrow('meta');
    });

    test('a cyclic container is rejected at construction', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;

        expect(() => new Carburetor({box: cyclic})).toThrow('cyclic');
    });

    test('setData(invalid) throws, leaving getData()/getVersion() unchanged', () => {
        const carburetor = new TestCarburetor(getTestData());
        const versionBefore = carburetor.getVersion();
        const dataBefore = carburetor.getData();
        const tag = Symbol('tag');

        expect(() => {
            carburetor.setData({...getTestData(), [tag]: 1} as unknown as ITestData);
        }).toThrow('symbol');

        expect(carburetor.getData()).toBe(dataBefore);
        expect(carburetor.getVersion()).toEqual(versionBefore);
    });

    test('restore(invalid) throws, leaving state unchanged', () => {
        const carburetor = new TestCarburetor(getTestData());
        const dataBefore = carburetor.getData();
        const bad: Record<string, unknown> = {...getTestData()};

        Object.defineProperty(bad, 'extra', {value: 1, enumerable: false, configurable: true, writable: true});

        expect(() => carburetor.restore(bad as unknown as ITestData)).toThrow('non-enumerable');
        expect(carburetor.getData()).toBe(dataBefore);
    });

    test('restore(snapshot()) on an already-valid state changes nothing and wakes nobody', () => {
        const carburetor = new TestCarburetor(getTestData());

        carburetor.setA(3);
        carburetor.setNestedValue(9);

        const versionBefore = carburetor.getVersion();
        let wakes = 0;

        carburetor.subscribe(() => wakes++, {id: 'watcher'});
        carburetor.restore(carburetor.snapshot());

        expect(carburetor.getVersion()).toEqual(versionBefore);
        expect(wakes).toEqual(0);
    });

    interface IDomainData {
        value: undefined;
        sparse: unknown[];
        dict: Record<string, unknown>;
        proto: Record<string, unknown>;
    }

    const buildDomain = (): IDomainData => {
        const sparse: unknown[] = [1];
        sparse[3] = 4; // a hole in the middle and a trailing one

        const dict: Record<string, unknown> = Object.create(null);
        dict.k = 'v';

        return {
            value: undefined,
            sparse,
            dict,
            proto: JSON.parse('{"__proto__":{"n":1},"safe":2}') as Record<string, unknown>,
        };
    };

    test('a snapshot/restore round trip preserves the whole valid domain', () => {
        const carburetor = new Carburetor<IDomainData>(buildDomain());
        const taken = carburetor.snapshot();

        carburetor.setData(buildDomain());
        carburetor.restore(taken);

        const data = carburetor.getData();

        expect(data.value).toBeUndefined();
        expect(data.sparse.length).toEqual(4);
        expect(Object.keys(data.sparse)).toEqual(['0', '3']);
        expect(1 in data.sparse).toEqual(false);
        expect(Object.getPrototypeOf(data.dict)).toBeNull();
        expect(data.dict.k).toEqual('v');
        expect(Object.getPrototypeOf(data.proto)).toEqual(Object.prototype);
        expect(Object.prototype.hasOwnProperty.call(data.proto, '__proto__')).toEqual(true);
        expect(data.proto.__proto__).toEqual({n: 1});
    });

    test('setData does not re-walk a subtree unchanged by reference', () => {
        let ownKeysCalls = 0;
        const rawBranch = {value: 1};
        const countedBranch = new Proxy(rawBranch, {
            ownKeys: (target) => {
                ownKeysCalls++;

                return Reflect.ownKeys(target);
            },
        }) as unknown as {value: number};

        const carburetor = new Carburetor<{box: {value: number}; other: number}>({box: countedBranch, other: 0});
        const callsAfterConstruct = ownKeysCalls;

        carburetor.setData({box: countedBranch, other: 1});

        expect(ownKeysCalls).toEqual(callsAfterConstruct);
    });
});

describe('supported plain-object prototype replacements (R13-E02)', () => {
    const nullItem = (): {value: number} => Object.assign(Object.create(null), {value: 1});

    test.each(['setData', 'restore'] as const)(
        '%s publishes nested prototype changes in both directions without changing sibling reads',
        operation => {
            const store = new Carburetor({item: {value: 1}, sibling: 5});
            const watchValues: string[] = [];
            const computedValues: string[] = [];
            const watched = store.watch(data => typeof data.item.toString, value => watchValues.push(value));
            const ownValues: number[] = [];
            const watchedOwn = store.watch(data => data.item.value, value => ownValues.push(value));
            const derived = computed(read => typeof read(store).item.toString);
            const derivedId = derived.subscribe(() => computedValues.push(derived.get()));
            let siblingWakes = 0;
            let ownWakes = 0;
            const sibling = store.subscribe(() => siblingWakes++, {reads: new Set(['sibling'])});
            const own = store.subscribe(() => ownWakes++, {reads: new Set(['item.value'])});

            expect(derived.get()).toBe('function');
            store[operation]({item: nullItem(), sibling: 5});
            expect(Object.getPrototypeOf(store.getData().item)).toBeNull();
            expect(typeof store.getData().item.toString).toBe('undefined');
            expect(derived.get()).toBe('undefined');
            expect(store.getVersion()).toBe(1);
            expect(watchValues).toEqual(['undefined']);
            expect(computedValues).toEqual(['undefined']);
            expect([siblingWakes, ownWakes]).toEqual([0, 1]);

            store[operation]({item: nullItem(), sibling: 5});
            expect(store.getVersion()).toBe(1);
            expect(watchValues).toEqual(['undefined']);
            expect(computedValues).toEqual(['undefined']);
            expect(ownValues).toEqual([]);
            expect([siblingWakes, ownWakes]).toEqual([0, 1]);

            store[operation]({item: {value: 1}, sibling: 5});
            expect(Object.getPrototypeOf(store.getData().item)).toBe(Object.prototype);
            expect(derived.get()).toBe('function');
            expect(store.getVersion()).toBe(2);
            expect(watchValues).toEqual(['undefined', 'function']);
            expect(computedValues).toEqual(['undefined', 'function']);
            expect([siblingWakes, ownWakes]).toEqual([0, 2]);
            watched();
            expect(ownValues).toEqual([]);
            watchedOwn();
            derived.unsubscribe(derivedId);
            store.unsubscribe(sibling);
            store.unsubscribe(own);
        }
    );

    test.each(['setData', 'restore'] as const)(
        '%s installs a root null prototype and then an ordinary root with one publication each',
        operation => {
            const store = new Carburetor<Record<string, number>>({value: 1});
            const wakes: number[] = [];
            const id = store.subscribe(() => wakes.push(store.getVersion()), {reads: new Set(['value'])});
            const next: Record<string, number> = Object.assign(Object.create(null), {value: 1});

            store[operation](next);
            expect(Object.getPrototypeOf(store.getData())).toBeNull();
            if (operation === 'restore') expect(store.getData()).not.toBe(next);
            expect(wakes).toEqual([1]);

            store[operation](Object.assign(Object.create(null), {value: 1}));
            expect(store.getVersion()).toBe(1);
            store[operation]({value: 1});
            expect(Object.getPrototypeOf(store.getData())).toBe(Object.prototype);
            expect(wakes).toEqual([1, 2]);
            store.unsubscribe(id);
        }
    );
});

describe('supported array prototype replacements (R13-E02A)', () => {
    const nullRows = (): number[] => Object.setPrototypeOf([1, 2], null);

    test.each(['setData', 'restore'] as const)(
        '%s publishes nested array prototype changes and keeps unchanged snapshots quiet',
        operation => {
            const store = new Carburetor({rows: [1, 2], sibling: 5});
            const observed: string[] = [];
            const watched = store.watch(data => typeof data.rows.map, value => observed.push(value));
            const derived = computed(read => {
                const rows = read(store).rows;

                return typeof rows.map === 'function' ? rows.map(value => value * 2).join(',') : 'no-map';
            });
            const derivedValues: string[] = [];
            const derivedId = derived.subscribe(() => derivedValues.push(derived.get()));
            let siblingWakes = 0;
            const sibling = store.subscribe(() => siblingWakes++, {reads: new Set(['sibling'])});

            expect(derived.get()).toBe('2,4');
            store[operation]({rows: nullRows(), sibling: 5});
            expect(Object.getPrototypeOf(store.getData().rows)).toBeNull();
            expect(typeof store.getData().rows.map).toBe('undefined');
            expect(derived.get()).toBe('no-map');
            expect([store.getVersion(), siblingWakes]).toEqual([1, 0]);
            expect(observed).toEqual(['undefined']);
            expect(derivedValues).toEqual(['no-map']);
            expect(Object.getPrototypeOf(store.snapshot().rows)).toBeNull();

            store[operation]({rows: nullRows(), sibling: 5});
            expect(store.getVersion()).toBe(1);
            store[operation]({rows: [1, 2], sibling: 5});
            expect(Object.getPrototypeOf(store.getData().rows)).toBe(Array.prototype);
            expect(derived.get()).toBe('2,4');
            expect([store.getVersion(), siblingWakes]).toEqual([2, 0]);
            expect(observed).toEqual(['undefined', 'function']);
            expect(derivedValues).toEqual(['no-map', '2,4']);
            watched();
            derived.unsubscribe(derivedId);
            store.unsubscribe(sibling);
        }
    );

    test.each(['setData', 'restore'] as const)(
        '%s installs the requested root array prototype in both directions',
        operation => {
            const store = new Carburetor([1, 2]);
            const next = nullRows();
            const versions: number[] = [];
            const id = store.subscribe(() => versions.push(store.getVersion()), {reads: new Set(['0'])});

            store[operation](next);
            expect(Object.getPrototypeOf(store.getData())).toBeNull();
            expect(Object.getPrototypeOf(store.snapshot())).toBeNull();
            if (operation === 'restore') expect(store.getData()).not.toBe(next);
            store[operation](nullRows());
            expect(versions).toEqual([1]);
            store[operation]([1, 2]);
            expect(Object.getPrototypeOf(store.getData())).toBe(Array.prototype);
            expect(versions).toEqual([1, 2]);
            store.unsubscribe(id);
        }
    );

    test('snapshot and restore also retain the other accepted array prototype', () => {
        const store = new Carburetor({rows: [1, 2]});
        const next = Object.setPrototypeOf([1, 2], Object.prototype) as number[];

        store.restore({rows: next});
        expect(Array.isArray(store.getData().rows)).toBe(true);
        expect(Object.getPrototypeOf(store.getData().rows)).toBe(Object.prototype);
        expect(Object.getPrototypeOf(store.snapshot().rows)).toBe(Object.prototype);
        expect(store.getVersion()).toBe(1);
        store.restore({rows: [1, 2]});
        expect(Object.getPrototypeOf(store.getData().rows)).toBe(Array.prototype);
        expect(store.getVersion()).toBe(2);
    });
});
