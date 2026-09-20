import {Carburetor, TPath, TPathSet, WILDCARD_PATH} from "../lib/src/Carburetor";

interface ITestData {
    a: number;
    b: number;
    nested: {
        value: number;
    };
}

const getTestData = (): ITestData => ({a: 0, b: 0, nested: {value: 0}});

class TestCarburetor extends Carburetor<ITestData> {
    public setA = (a: number) => {
        this.draft.a = a;

        this.emitUpdate();
    };

    public setB = (b: number) => {
        this.draft.b = b;

        this.emitUpdate();
    };

    public setNestedValue = (value: number) => {
        this.draft.nested.value = value;

        this.emitUpdate();
    };

    /** A write bypassing draft: the carburetor cannot know the changed paths and must wake everyone. */
    public setAUntracked = (a: number) => {
        this.data.a = a;

        this.emitUpdate();
    };
}

const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('Carburetor', () => {
    test('notifies subscribers synchronously by default', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, 'subscriber', readsOf('a'));

        carburetor.setA(1);

        expect(calls).toEqual(1);
        expect(carburetor.getData().a).toEqual(1);
    });

    test('wakes only subscribers that read the written path', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, 'a-reader', readsOf('a'));
        carburetor.subscribe(() => readerOfB++, 'b-reader', readsOf('b'));

        carburetor.setA(1);

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);

        carburetor.setB(2);

        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(1);
    });

    test('matches nested paths in both directions', () => {
        const carburetor = new TestCarburetor(getTestData());
        let deepReader = 0;
        let containerReader = 0;
        let unrelatedReader = 0;

        carburetor.subscribe(() => deepReader++, 'deep', readsOf('nested.value'));
        carburetor.subscribe(() => containerReader++, 'container', readsOf('nested'));
        carburetor.subscribe(() => unrelatedReader++, 'unrelated', readsOf('a'));

        carburetor.setNestedValue(1);

        expect(deepReader).toEqual(1);
        expect(containerReader).toEqual(1);
        expect(unrelatedReader).toEqual(0);
    });

    test('subscriber without a read set gets every update', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, 'wildcard');

        carburetor.setA(1);
        carburetor.setB(2);

        expect(calls).toEqual(2);
    });

    test('falls back to waking everyone when writes bypass draft', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, 'b-reader', readsOf('b'));

        carburetor.setAUntracked(1);

        expect(readerOfB).toEqual(1);
    });

    test('setData replaces data and invalidates everything', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, 'b-reader', readsOf('b'));

        const next = getTestData();
        next.a = 5;
        carburetor.setData(next);

        expect(carburetor.getData()).toEqual(next);
        expect(readerOfB).toEqual(1);
    });

    test('unsubscribe stops notifications', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, 'subscriber', readsOf('a'));
        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.unsubscribe('subscriber');
        carburetor.setA(2);

        expect(calls).toEqual(1);
    });

    test('version grows with every update', () => {
        const carburetor = new TestCarburetor(getTestData());
        const initial = carburetor.getVersion();

        carburetor.setA(1);
        carburetor.setB(2);

        expect(carburetor.getVersion()).toEqual(initial + 2);
    });

    test('read tracks leaves, not traversal through branches', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));
        const used = data.a + data.nested.value;

        expect(used).toEqual(0);
        expect(reads.has('a')).toBeTruthy();
        expect(reads.has('nested.value')).toBeTruthy();
        // Traversing through `nested` does not become a subscription on its own.
        expect(reads.has('nested')).toBeFalsy();
        expect(reads.has('b')).toBeFalsy();
        expect(reads.has(WILDCARD_PATH)).toBeFalsy();
    });

    test('enumerating a branch subscribes to the branch itself', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = new Set<TPath>();

        const data = carburetor.read((path: TPath) => reads.add(path));
        const keys = Object.keys(data.nested);

        expect(keys).toEqual(['value']);
        expect(reads.has('nested')).toBeTruthy();
    });

    test('writing the same value wakes nobody', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, 'a-reader', readsOf('a'));

        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.setA(2);
        expect(calls).toEqual(2);
    });

    test('draft stays correct after a nested branch is replaced', () => {
        interface IListData {
            ids: string[];
        }

        class ListCarburetor extends Carburetor<IListData> {
            public replaceIds = (ids: string[]) => {
                this.draft.ids = ids;

                this.emitUpdate();
            };

            public pushId = (id: string) => {
                this.draft.ids.push(id);

                this.emitUpdate();
            };
        }

        const carburetor = new ListCarburetor({ids: ['a']});

        carburetor.pushId('b');
        expect(carburetor.getData().ids).toEqual(['a', 'b']);

        // After the array is replaced, draft must work with the new object, not the previous one.
        carburetor.replaceIds(['x']);
        carburetor.pushId('y');

        expect(carburetor.getData().ids).toEqual(['x', 'y']);
    });

    test('data read through the proxy cannot be mutated', () => {
        const carburetor = new TestCarburetor(getTestData());
        const data = carburetor.read(() => undefined);

        expect(() => {
            data.a = 1;
        }).toThrow();
    });
});
