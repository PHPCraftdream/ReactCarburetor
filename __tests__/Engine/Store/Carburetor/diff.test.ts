import {Carburetor} from "@/Carburetor";
import {TPath} from "@/Carburetor/Models/Paths";
import {getTestData, readsOf, TestCarburetor} from "./fixtures";

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

    test('past DIFF_PATH_THRESHOLD differing leaves, the write falls back to the wildcard', () => {
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

        // Every one of 2500 keys differs: the threshold gives up on individual leaves and
        // wildcards, which is the only way an unrelated reader would be woken here.
        expect(unrelatedWakes).toEqual(1);
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

    test('a symbol-key difference at the root falls back to the wildcard', () => {
        const tag = Symbol('tag');
        const carburetor = new FlexCarburetor({a: 1, [tag]: 'x'});
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'watcher', reads: readsOf('a')});

        const snapshot: Record<string | symbol, unknown> = {a: 1, [tag]: 'y'};
        carburetor.restore(snapshot);

        // `a` itself did not change, but the symbol-keyed difference forces the whole root.
        expect(calls).toEqual(1);
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
