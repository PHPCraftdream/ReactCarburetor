import {Carburetor, CarburetorHistory} from "@/Carburetor";
import {TPath} from "@/Carburetor/Models/Paths";
import {getTestData, readsOf, TestCarburetor} from "./fixtures";

describe('Carburetor', () => {    test('draft stays correct after a nested branch is replaced', () => {
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
        // The type is deeply read-only, so a write has to be forced past the compiler
        // to reach the runtime guard at all.
        const data = carburetor.read(() => undefined) as unknown as ITestData;

        expect(() => {
            data.a = 1;
        }).toThrow();
    });

    test('Object.defineProperty on the read view throws and changes nothing', () => {
        const carburetor = new TestCarburetor(getTestData());
        const data = carburetor.read(() => undefined) as unknown as ITestData;

        expect(() => {
            Object.defineProperty(data, 'a', {value: 1});
        }).toThrow('read-only');

        expect(carburetor.getData().a).toEqual(0);
    });

    test('a descriptor read hands out the wrapped branch, not the raw object', () => {
        const carburetor = new TestCarburetor(getTestData());
        const data = carburetor.read(() => undefined) as unknown as ITestData;
        const descriptor = Object.getOwnPropertyDescriptor(data, 'nested') as PropertyDescriptor;

        // The raw object would be a mutation path around every trap the view installs.
        expect(descriptor.value).not.toBe(carburetor.getData().nested);

        expect(() => {
            (descriptor.value as {value: number}).value = 5;
        }).toThrow('read-only');

        expect(carburetor.getData().nested.value).toEqual(0);
    });

    test('enumerating keys wraps nothing and subscribes to the structure alone', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = new Set<TPath>();
        const data = carburetor.read((path: TPath) => reads.add(path)) as unknown as ITestData;

        expect(Object.keys(data.nested)).toEqual(['value']);

        // The gOPD call the enumeration performs is a structure check, not a value read:
        // recording it would wake this reader when only `nested.value` changes. It also
        // subscribes to the key-set marker (R16-01), not `nested`'s own path — a value write
        // under an unchanged key set must not wake an enumerator either.
        expect(reads.has('nested.value')).toBeFalsy();
        expect(reads.has('nested')).toBeFalsy();
        expect(reads.has('nested.~k')).toBeTruthy();
    });

    test('reading into a frozen branch refuses with the path instead of the raw TypeError', () => {
        interface IFrozenData {
            outer: {inner: {value: number}; note: string};
            leaf: number;
        }

        const getFrozenData = (): IFrozenData => ({
            outer: Object.freeze({inner: {value: 0}, note: 'first'}),
            leaf: 0,
        });

        const carburetor = new Carburetor<IFrozenData>(getFrozenData());
        const data = carburetor.read(() => undefined) as unknown as IFrozenData;

        expect(() => data.outer.inner).toThrow('outer.inner');
        expect(() => data.outer.inner).toThrow('non-configurable');
        expect(carburetor.getData().outer.inner.value).toEqual(0);

        // A leaf of the frozen branch is a primitive read: invariant-safe and still tracked.
        const reads = new Set<TPath>();
        const tracked = carburetor.read((path: TPath) => reads.add(path)) as unknown as IFrozenData;

        expect(tracked.outer.note).toEqual('first');
        expect(reads.has('outer.note')).toBeTruthy();
    });

    test('a frozen root refuses nested reads the same way, primitives stay readable', () => {
        const carburetor = new TestCarburetor(Object.freeze(getTestData()));
        const data = carburetor.read(() => undefined) as unknown as ITestData;

        expect(() => data.nested).toThrow('"nested"');
        expect(data.a).toEqual(0);
    });

    test('a presence check on a branch hears about replacement, not about nested writes', () => {
        interface IProfileData {
            user: {name: string} | null;
        }

        class ProfileCarburetor extends Carburetor<IProfileData> {
            public setUser = (user: {name: string} | null) => {
                this.draft.user = user;

                this.emitUpdate();
            };

            public rename = (name: string) => {
                this.update((draft: IProfileData) => {
                    const user = draft.user;

                    if (user) {
                        user.name = name;
                    }
                });
            };
        }

        const carburetor = new ProfileCarburetor({user: {name: 'first'}});
        const reads = new Set<TPath>();
        let renders = 0;

        const data = carburetor.read((path: TPath) => reads.add(path));
        const present = !!data.user;

        carburetor.subscribe(() => renders++, {id: 'presence', reads});

        expect(present).toBeTruthy();
        // The check read no leaf: nothing stands for it but the branch marker.
        expect(reads.has('user')).toBeFalsy();

        // A leaf changing under the intact branch is not a presence change.
        carburetor.rename('second');
        expect(renders).toEqual(0);

        // Replacing the branch is.
        carburetor.setUser(null);
        expect(renders).toEqual(1);
    });

    // R6-02/R6-03: a getter is no longer valid state — accessors are incompatible with paths,
    // diffing and cloning; the constructor now rejects one before it is ever read, and never
    // invokes it while checking. See StateModel.test.ts for the fuller coverage of this
    // rejection (root, nested, and through draft).
    test('a getter in the initial state is rejected at construction, without ever being invoked', () => {
        interface IDoublerData {
            n: number;
            readonly doubled: number;
        }

        let calls = 0;

        const getDoublerData = (): IDoublerData => ({
            n: 1,
            get doubled(): number {
                calls++;

                return this.n * 2;
            },
        });

        expect(() => new Carburetor<IDoublerData>(getDoublerData())).toThrow('doubled');
        expect(calls).toEqual(0);
    });

    test('an object reachable under two paths is reported when read and when written', () => {
        interface IAliasData {
            a: {n: number};
            b: {n: number};
        }

        class AliasCarburetor extends Carburetor<IAliasData> {
            public writeThroughA = (n: number) => {
                this.update((draft: IAliasData) => {
                    draft.a.n = n;
                });
            };
        }

        const shared = {n: 0};
        const carburetor = new AliasCarburetor({a: shared, b: shared});
        let bReader = 0;

        carburetor.subscribe(() => bReader++, {id: 'b-reader', reads: readsOf('b.n')});

        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            const reads = new Set<TPath>();
            const data = carburetor.read((path: TPath) => reads.add(path));

            void data.a.n;
            void data.b.n;
            carburetor.writeThroughA(1);
        } finally {
            console.error = original;
        }

        // One report for the read that found the object under a second path, one for the write
        // into it. The drift itself stays silent — the report is the contract, not a fix.
        expect(reported.length).toEqual(2);
        expect(reported[0]).toContain('two paths');
        expect(reported[1]).toContain('also read at');
        expect(bReader).toEqual(0);
        expect(carburetor.getData().b.n).toEqual(1);
    });

    test('a key containing the separator stays distinct from real nesting', () => {
        interface IDottedData {
            'a.b': {v: number};
            a: {b: {v: number}};
        }

        class DottedCarburetor extends Carburetor<IDottedData> {
            public writeFlat = (v: number) => {
                this.update((draft: IDottedData) => {
                    draft['a.b'].v = v;
                });
            };

            public writeNested = (v: number) => {
                this.update((draft: IDottedData) => {
                    draft.a.b.v = v;
                });
            };
        }

        const carburetor = new DottedCarburetor({'a.b': {v: 0}, a: {b: {v: 0}}});

        const reads = new Set<TPath>();
        const data = carburetor.read((path: TPath) => reads.add(path));

        void data['a.b'].v;
        void data.a.b.v;

        // The dotted key is one escaped segment, not the nested path.
        expect(reads.has('a~1b.v')).toBeTruthy();
        expect(reads.has('a.b.v')).toBeTruthy();

        let flat = 0;
        let nested = 0;

        carburetor.subscribe(() => flat++, {id: 'flat-reader', reads: readsOf('a~1b.v')});
        carburetor.subscribe(() => nested++, {id: 'nested-reader', reads: readsOf('a.b.v')});

        carburetor.writeFlat(1);
        expect(carburetor.getData()['a.b'].v).toEqual(1);
        expect(flat).toEqual(1);
        expect(nested).toEqual(0);

        carburetor.writeNested(2);
        expect(carburetor.getData().a.b.v).toEqual(2);
        expect(flat).toEqual(1);
        expect(nested).toEqual(1);
    });

});

describe('native collection draft arguments keep raw aliases', () => {
    interface INativeState {
        key: {id: number};
        map: Map<object | string, object | number>;
        set: Set<object>;
    }

    class NativeStore extends Carburetor<INativeState> {
        public edit(mutate: (draft: INativeState) => void): void {
            this.update(mutate);
        }
    }

    test('Map keys, Map root/key values and Set values stay canonical through undo/redo', () => {
        const key = {id: 1};
        const store = new NativeStore({
            key, map: new Map([[key, 1]]), set: new Set(),
        });
        const history = new CarburetorHistory(store);

        store.edit(draft => {
            const map = draft.map;
            expect(map).toBe(draft.map);
            expect(map.set(draft.key, 2)).toBe(map);
            expect(map.set('root', draft).set('key', draft.key)).toBe(map);
            expect(draft.set.add(draft.key)).toBe(draft.set);
        });

        const after = store.getData();
        expect(after.map.size).toBe(3);
        expect(after.map.get(after.key)).toBe(2);
        expect(after.map.get('root')).toBe(after);
        expect(after.map.get('key')).toBe(after.key);
        expect(after.set.has(after.key)).toBe(true);

        expect(history.undo()).toBe(true);
        const undone = store.getData();
        expect(undone.map.size).toBe(1);
        expect(undone.map.get(undone.key)).toBe(1);
        expect(undone.set.has(undone.key)).toBe(false);

        expect(history.redo()).toBe(true);
        const redone = store.getData();
        expect(redone.map.size).toBe(3);
        expect(redone.map.get(redone.key)).toBe(2);
        expect(redone.map.get('root')).toBe(redone);
        expect(redone.map.get('key')).toBe(redone.key);
        expect(redone.set.has(redone.key)).toBe(true);
        history.disconnect();
    });

    test('delete and membership normalize tracked aliases without changing native method receivers', () => {
        const key = {id: 1};
        const store = new NativeStore({key, map: new Map([[key, 1]]), set: new Set([key])});
        store.edit(draft => {
            expect(draft.map.has(draft.key)).toBe(true);
            expect(draft.set.has(draft.key)).toBe(true);
            expect(draft.map.delete(draft.key)).toBe(true);
            expect(draft.set.delete(draft.key)).toBe(true);
            expect(draft.map.size).toBe(0);
            expect(draft.set.size).toBe(0);
        });
        expect(store.getData().map.has(key)).toBe(false);
        expect(store.getData().set.has(key)).toBe(false);
    });

    test('native intrinsic receivers and read-view arguments preserve the original collection', () => {
        const key = {id: 1};
        const map = new Map<object | string, object | number>([[key, 1]]);
        const set = new Set<object>();
        const store = new NativeStore({key, map, set});
        const view = store.read(() => undefined);

        store.edit(draft => {
            const borrowed = draft.map.set;
            expect(draft.map instanceof Map).toBe(true);
            expect(draft.map.entries().next().value).toEqual([key, 1]);
            expect(borrowed.call(draft.map, view.key, 2)).toBe(draft.map);
            expect(borrowed.call(map, 'read', view)).toBe(map);
            expect(draft.set.add(view.key)).toBe(draft.set);
        });

        expect(map.size).toBe(2);
        expect(map.get(key)).toBe(2);
        expect(map.get('read')).toBe(store.getData());
        expect(set.has(key)).toBe(true);
    });

    test('forEach exposes its current facade for nested key lookups and keeps native callback semantics', () => {
        const key = {id: 1};
        const store = new NativeStore({key, map: new Map([[key, 1]]), set: new Set([key])});
        const view = store.read(() => undefined);
        const context: {value: object | number | undefined} = {value: undefined};
        view.map.forEach(function (this: typeof context, value, entry, collection) {
            expect(collection).toBe(view.map);
            expect(entry).toBe(key);
            expect(value).toBe(1);
            this.value = collection.get(view.key);
        }, context);
        expect(context.value).toBe(1);
        let member: object | undefined;
        view.set.forEach((value, entry, collection) => {
            expect(collection).toBe(view.set);
            expect(value).toBe(entry);
            expect(collection.has(view.key)).toBe(true);
            member = value;
        });
        expect(member).toBe(key);
        const empty = new NativeStore({key, map: new Map(), set: new Set()}).read(() => undefined);
        expect(() => Reflect.apply(empty.map.forEach, empty.map, [null])).toThrow(TypeError);
        expect(() => Reflect.apply(empty.set.forEach, empty.set, [null])).toThrow(TypeError);
    });
});
