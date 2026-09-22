import {Carburetor, diagnostics, TPath, TPathSet, WILDCARD_PATH} from "@/Carburetor";

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

    /** The recommended form: mutate and publish in one step. */
    public setAThroughUpdate = (a: number) => {
        this.update((draft: ITestData) => {
            draft.a = a;
        });
    };

    /** An async mutation: the write lands after update() has already published. */
    public setAThroughAsyncUpdate = (a: number) => {
        // The rule is right; this proves the runtime diagnostic catches it as well.
        // oxlint-disable-next-line carburetor/no-async-transaction
        this.update(async (draft: ITestData) => {
            await Promise.resolve();

            draft.a = a;
        });
    };

    /** Writes through draft and never publishes — the mistake the dev check reports. */
    public setAWithoutEmit = (a: number) => {
        // The rule is right; this method exists to prove the runtime check catches it too.
        // oxlint-disable-next-line carburetor/require-emit-after-draft-write
        this.draft.a = a;
    };

    /** A write bypassing draft: the carburetor cannot know the changed paths and must wake everyone. */
    public setAUntracked = (a: number) => {
        // oxlint-disable-next-line carburetor/no-direct-data-write
        this.data.a = a;

        this.emitUpdate();
    };
}

const readsOf = (...paths: TPath[]): TPathSet => new Set<TPath>(paths);

describe('Carburetor', () => {
    test('notifies subscribers synchronously by default', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads: readsOf('a')});

        carburetor.setA(1);

        expect(calls).toEqual(1);
        expect(carburetor.getData().a).toEqual(1);
    });

    test('wakes only subscribers that read the written path', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

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

        carburetor.subscribe(() => deepReader++, {id: 'deep', reads: readsOf('nested.value')});
        carburetor.subscribe(() => containerReader++, {id: 'container', reads: readsOf('nested')});
        carburetor.subscribe(() => unrelatedReader++, {id: 'unrelated', reads: readsOf('a')});

        carburetor.setNestedValue(1);

        expect(deepReader).toEqual(1);
        expect(containerReader).toEqual(1);
        expect(unrelatedReader).toEqual(0);
    });

    test('subscriber without a read set gets every update', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'wildcard'});

        carburetor.setA(1);
        carburetor.setB(2);

        expect(calls).toEqual(2);
    });

    test('falls back to waking everyone when writes bypass draft', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setAUntracked(1);

        expect(readerOfB).toEqual(1);
    });

    test('setData replaces data and invalidates everything', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        const next = getTestData();
        next.a = 5;
        carburetor.setData(next);

        expect(carburetor.getData()).toEqual(next);
        expect(readerOfB).toEqual(1);
    });

    test('unsubscribe stops notifications', () => {
        const carburetor = new TestCarburetor(getTestData());
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads: readsOf('a')});
        carburetor.setA(1);
        expect(calls).toEqual(1);

        carburetor.unsubscribe('subscriber');
        carburetor.setA(2);

        expect(calls).toEqual(1);
    });

    test('update mutates and publishes once, keeping path precision', () => {
        const carburetor = new TestCarburetor(getTestData());
        let readerOfA = 0;
        let readerOfB = 0;

        carburetor.subscribe(() => readerOfA++, {id: 'a-reader', reads: readsOf('a')});
        carburetor.subscribe(() => readerOfB++, {id: 'b-reader', reads: readsOf('b')});

        carburetor.setAThroughUpdate(1);

        expect(carburetor.getData().a).toEqual(1);
        expect(readerOfA).toEqual(1);
        expect(readerOfB).toEqual(0);
    });

    test('reports a draft write that was never published', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            carburetor.setAWithoutEmit(1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('emitUpdate');
    });

    test('reports an async mutation handed to update', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];
        let calls = 0;

        console.error = (message: string) => reported.push(message);
        carburetor.subscribe(() => calls++, {id: 'a-reader', reads: readsOf('a')});

        try {
            carburetor.setAThroughAsyncUpdate(1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        expect(reported.length).toEqual(1);
        expect(reported[0]).toContain('promise');
        // The hazard itself: the value did change, and nobody was woken for it.
        expect(carburetor.getData().a).toEqual(1);
        expect(calls).toEqual(0);
    });

    test('stays quiet when the write is published', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);

        try {
            carburetor.setAThroughUpdate(1);
            carburetor.setA(2);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            console.error = original;
        }

        expect(reported).toEqual([]);
    });

    test('diagnostics can be switched off', async () => {
        const carburetor = new TestCarburetor(getTestData());
        const original = console.error;
        const reported: string[] = [];

        console.error = (message: string) => reported.push(message);
        diagnostics.setEnabled(false);

        try {
            carburetor.setAWithoutEmit(1);

            await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
        } finally {
            diagnostics.setEnabled(true);
            console.error = original;
        }

        expect(reported).toEqual([]);
    });

    test('diagnostics are on by default outside production', () => {
        expect(diagnostics.isEnabled()).toBeTruthy();
    });

    test('survives a subscriber unsubscribing another during delivery', () => {
        const carburetor = new TestCarburetor(getTestData());
        let tail = 0;

        carburetor.subscribe(() => carburetor.unsubscribe('tail'), {id: 'head'});
        carburetor.subscribe(() => tail++, {id: 'tail'});

        expect(() => carburetor.setA(1)).not.toThrow();
        expect(tail).toEqual(0);
    });

    test('subscribing with the same id replaces the previous registration', () => {
        const carburetor = new TestCarburetor(getTestData());
        let first = 0;
        let second = 0;

        carburetor.subscribe(() => first++, {id: 'same', reads: readsOf('a')});
        carburetor.subscribe(() => second++, {id: 'same', reads: readsOf('a')});

        carburetor.setA(1);

        expect(first).toEqual(0);
        expect(second).toEqual(1);
    });

    test('the read set handed to subscribe is copied, not held live', () => {
        const carburetor = new TestCarburetor(getTestData());
        const reads = readsOf('a');
        let calls = 0;

        carburetor.subscribe(() => calls++, {id: 'subscriber', reads});

        // Extending the caller's set afterwards must not widen the subscription.
        reads.add('b');
        carburetor.setB(1);

        expect(calls).toEqual(0);

        carburetor.setA(1);
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

        carburetor.subscribe(() => calls++, {id: 'a-reader', reads: readsOf('a')});

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
        // The type is deeply read-only, so a write has to be forced past the compiler
        // to reach the runtime guard at all.
        const data = carburetor.read(() => undefined) as unknown as ITestData;

        expect(() => {
            data.a = 1;
        }).toThrow();
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
