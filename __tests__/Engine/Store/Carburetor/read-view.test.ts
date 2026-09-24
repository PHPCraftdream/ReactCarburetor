import {Carburetor, TPath} from "@/Carburetor";
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
        // recording it would wake this reader when only `nested.value` changes.
        expect(reads.has('nested.value')).toBeFalsy();
        expect(reads.has('nested')).toBeTruthy();
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

    test('a getter reads through the proxy, so the reads inside it are tracked', () => {
        interface IDoublerData {
            n: number;
            readonly doubled: number;
        }

        const getDoublerData = (): IDoublerData => ({
            n: 1,
            get doubled(): number {
                return this.n * 2;
            },
        });

        class DoublerCarburetor extends Carburetor<IDoublerData> {
            public setN = (n: number) => {
                this.update((draft: IDoublerData) => {
                    draft.n = n;
                });
            };
        }

        const carburetor = new DoublerCarburetor(getDoublerData());
        const reads = new Set<TPath>();
        let renders = 0;

        const data = carburetor.read((path: TPath) => reads.add(path));
        const doubled = data.doubled;

        carburetor.subscribe(() => renders++, {id: 'doubled-reader', reads});

        expect(doubled).toEqual(2);
        expect(reads.has('doubled')).toBeTruthy();
        // `this.n` inside the getter went through the proxy: the reader depends on `n` too.
        expect(reads.has('n')).toBeTruthy();

        carburetor.setN(5);
        expect(renders).toEqual(1);
        expect(carburetor.read(() => undefined).doubled).toEqual(10);
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
