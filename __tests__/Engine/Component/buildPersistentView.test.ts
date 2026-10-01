import {AntiHookComponent, Carburetor, CarburetorHistory} from "@/Carburetor";
import {IConnection, IConnectionSource, IRenderAttempt} from "@/Carburetor/Component/Models/Connection";
import {declareConnection} from "@/Carburetor/Component/Connection/declareConnection";
import {buildPersistentView} from "@/Carburetor/Component/Connection/buildPersistentView";
import {ConnectionFacadeHandler} from "@/Carburetor/Component/Connection/ConnectionFacadeHandler";
import {detachSelection} from "@/Carburetor/Component/Connection/detachSelection";
import {PROXY_CACHE} from "@/Carburetor/Store/Tracking/Models";

/**
 * Builds one connection with no render attempt ever open — `resolveAttemptSource` then calls
 * the resolver directly on every read, the same way an event handler or the declaration-time
 * shape probe reads it, without needing a React mount to exercise `buildPersistentView` itself.
 */
const declare = <T extends object>(source: () => Carburetor<T>) =>
    declareConnection<T>([] as IConnection[], () => undefined, source);

describe('buildPersistentView shape probe (R3-11: a genuine resolver error must not be lost)', () => {
    test('a resolver whose first call throws a genuine unrelated error keeps it as the later mismatch\'s cause', () => {
        const arrayStore = new Carburetor<Array<{id: number}>>([{id: 1}]);
        const bug = new Error('unrelated: config lookup blew up');
        let calls = 0;

        // The declaration-time shape probe hits this once and it throws for a reason that has
        // nothing to do with "not ready yet"; the first real read (below) calls it again and
        // gets a legitimate array root.
        const resolver = (): Carburetor<Array<{id: number}>> => {
            calls += 1;

            if (calls === 1) {
                throw bug;
            }

            return arrayStore;
        };

        const view = buildPersistentView(declare(resolver));

        let thrown: unknown;

        try {
            void (view as unknown as ReadonlyArray<{id: number}>).length;
        } catch (error) {
            thrown = error;
        }

        // The probe already consumed the resolver's one throw, so the read below observes a
        // real declared/resolved kind mismatch: object-shaped (the probe saw nothing), array-shaped.
        expect(calls).toEqual(2);
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toContain('array');
        // Not silently discarded behind the generic "not resolvable at declaration time"
        // wording: the original bug survives as the thrown error's cause.
        expect((thrown as Error).cause).toBe(bug);
    });

    test('a resolver that only ever reports "not ready yet" still declares and reads normally, unaffected', () => {
        const objectStore = new Carburetor<{value: number}>({value: 0});
        let calls = 0;

        // The legitimate deferred case (a scope-backed resolver before context is filled in):
        // throws once, then consistently resolves to the same, declared kind.
        const resolver = (): Carburetor<{value: number}> => {
            calls += 1;

            if (calls === 1) {
                throw new Error('not ready yet');
            }

            return objectStore;
        };

        const view = buildPersistentView(declare(resolver));

        expect(view.value).toEqual(0);
        expect(calls).toEqual(2);

        objectStore.setData({value: 1});

        expect(view.value).toEqual(1);
    });

    test('a probe that never throws reports a genuine later kind change without a cause (unchanged behavior)', () => {
        type TFlex = {id: number} | ReadonlyArray<{id: number}>;

        const arrayStore = new Carburetor<Array<{id: number}>>([{id: 1}]);
        const objectStore = new Carburetor<{id: number}>({id: 1});
        let useArray = false;

        const resolver = (): Carburetor<TFlex> =>
            (useArray ? arrayStore : objectStore) as unknown as Carburetor<TFlex>;

        const view = buildPersistentView(declare(resolver));

        expect((view as {id: number}).id).toEqual(1);

        useArray = true;

        let thrown: unknown;

        try {
            void (view as unknown as ReadonlyArray<{id: number}>).length;
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).cause).toBeUndefined();
    });
});

/** A minimal, self-contained IConnectionSource — no declareConnection involved — for tests that
 * only care about ConnectionFacadeHandler's own shape, not the declaration machinery behind it.
 */
const stubSource = <T extends object>(carburetor: Carburetor<T>): IConnectionSource<T> => ({
    connection: {uid: 'stub', getCarburetor: () => carburetor, committed: undefined, installed: undefined},
    getCarburetor: () => carburetor,
    resolveAttemptSource: () => carburetor,
    recorder: () => undefined,
    arrayFacade: false,
    probeError: undefined,
    cachedTarget: undefined,
    cachedView: undefined,
});

describe('ConnectionFacadeHandler traps are shared across declarations (R15-06)', () => {
    test('a handler instance owns no trap functions of its own — every trap lives on the shared prototype', () => {
        const handler = new ConnectionFacadeHandler(stubSource(new Carburetor<{value: number}>({value: 1})));

        // The pre-fix shape built one object literal of a dozen trap closures per declaration:
        // each trap would be this object's own property. A prototype method never is.
        expect(Object.getOwnPropertyNames(handler)).toEqual(['source']);
    });

    test('two declarations\' handlers share the exact same trap functions and prototype', () => {
        const handlerA = new ConnectionFacadeHandler(stubSource(new Carburetor<{value: number}>({value: 1})));
        const handlerB = new ConnectionFacadeHandler(stubSource(new Carburetor<{value: number}>({value: 2})));

        expect(Object.getPrototypeOf(handlerA)).toBe(Object.getPrototypeOf(handlerB));

        (
            [
                'get', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf',
                'setPrototypeOf', 'preventExtensions', 'set', 'deleteProperty', 'defineProperty',
            ] as const
        ).forEach((trap) => {
            expect(handlerA[trap]).toBe(handlerB[trap]);
        });
    });

    test('two persistent views built through the shared handler prototype stay independent', () => {
        const storeA = new Carburetor<{value: number}>({value: 1});
        const storeB = new Carburetor<{value: number}>({value: 100});

        const viewA = buildPersistentView(declare(() => storeA));
        const viewB = buildPersistentView(declare(() => storeB));

        expect(viewA.value).toEqual(1);
        expect(viewB.value).toEqual(100);

        storeA.setData({value: 2});

        // Rebuilding A's cached view must not disturb B's, even though both facades' traps
        // resolve to the exact same shared function objects.
        expect(viewA.value).toEqual(2);
        expect(viewB.value).toEqual(100);
    });
});

describe('buildPersistentView PROXY_CACHE peek (test-only introspection hatch)', () => {
    test('peeking PROXY_CACHE before any real read never resolves the source', () => {
        const store = new Carburetor<{value: number}>({value: 1});
        let resolves = 0;

        const resolver = (): Carburetor<{value: number}> => {
            resolves += 1;

            return store;
        };

        const view = buildPersistentView(declare(resolver));
        const afterDeclare = resolves;

        expect((view as unknown as {[PROXY_CACHE]?: unknown})[PROXY_CACHE]).toBeUndefined();
        expect(resolves).toEqual(afterDeclare);

        expect(view.value).toEqual(1);
        expect((view as unknown as {[PROXY_CACHE]?: unknown})[PROXY_CACHE]).toBeDefined();
    });
});

describe('resolveAttemptSource memoizes per attempt (declareConnection.ts)', () => {
    test('reading several fields in one attempt resolves the source once, not once per read', () => {
        const store = new Carburetor<{value: number; other: number}>({value: 1, other: 2});
        let resolves = 0;

        const resolver = (): Carburetor<{value: number; other: number}> => {
            resolves += 1;

            return store;
        };

        const attempt: IRenderAttempt = {
            tracked: undefined, connections: undefined, sources: undefined,
            deferredLoads: undefined, abandoned: false,
        };

        const declared = declareConnection<{value: number; other: number}>(
            [] as IConnection[], () => attempt, resolver
        );
        const view = buildPersistentView(declared);

        // The shape probe's one call, made with no attempt open.
        expect(resolves).toEqual(1);

        void view.value;
        void view.other;
        void view.value;

        // One more call — this attempt's first read — and then the memo answers the rest.
        expect(resolves).toEqual(2);
    });
});

describe('buildPersistentView descriptor relaxation (array length stays non-configurable)', () => {
    test('an ordinary array root\'s "length" is forwarded unchanged, matching the empty target\'s own', () => {
        const store = new Carburetor<number[]>([1, 2, 3]);
        const view = buildPersistentView(declare(() => store)) as unknown as number[];

        // "length" is intrinsically non-configurable on every array, frozen or not — the facade's
        // own empty array target owns it non-configurably too, so it is forwarded exactly as-is
        // instead of being relaxed (relaxing it would contradict the target's own "length").
        const length = Object.getOwnPropertyDescriptor(view, 'length');

        expect(length?.configurable).toBe(false);
        expect(length?.writable).toBe(true);
        expect(length?.value).toEqual(3);
    });

    test('a frozen array root relaxes a non-configurable element descriptor to configurable', () => {
        const store = new Carburetor<ReadonlyArray<number>>(Object.freeze([1, 2, 3]));
        const view = buildPersistentView(declare(() => store)) as unknown as ReadonlyArray<number>;

        // An element index is not one of the empty target's own properties, so its
        // non-configurable descriptor (frozen source) is relaxed to configurable — the only
        // lawful answer over an empty target, made safe because every mutation trap still
        // rejects any write.
        const element = Object.getOwnPropertyDescriptor(view, '0');

        expect(element?.configurable).toBe(true);
        expect(element?.value).toEqual(1);
    });
});

describe('persistent array facade length locks', () => {
    test('descriptor queries remain lawful across a root lock, undo, redo and independent facades', () => {
        const store = new Carburetor<number[]>([1, 2, 3]);
        const other = new Carburetor<number[]>([9, 8]);
        const history = new CarburetorHistory(store);
        const view = buildPersistentView(declare(() => store)) as number[];
        const sibling = buildPersistentView(declare(() => other)) as number[];
        const descriptor = (value: number[]): PropertyDescriptor =>
            Object.getOwnPropertyDescriptor(value, 'length')!;

        expect(descriptor(view)).toMatchObject({value: 3, writable: true, configurable: false});
        store.update(draft => { Object.defineProperty(draft, 'length', {value: 1, writable: false}); });
        expect(descriptor(store.getData()).writable).toBe(false);
        // The facade must report writable:true over its shared, still-writable array target.
        expect(descriptor(view)).toMatchObject({value: 1, writable: true, configurable: false});
        expect(view.length).toBe(1);
        expect('length' in view).toBe(true);
        expect(Reflect.ownKeys(view)).toEqual(['0', 'length']);
        expect(descriptor(sibling)).toMatchObject({value: 2, writable: true});

        expect(history.undo()).toBe(true);
        expect(descriptor(view)).toMatchObject({value: 3, writable: true});
        expect(view.length).toBe(3);
        expect(history.redo()).toBe(true);
        expect(descriptor(view)).toMatchObject({value: 1, writable: true});
        expect(view.length).toBe(1);

        other.update(draft => { Object.defineProperty(draft, 'length', {writable: false}); });
        expect(descriptor(sibling)).toMatchObject({value: 2, writable: true});
        expect(descriptor(view)).toMatchObject({value: 1, writable: true});
        other.setData([7, 6, 5, 4]);
        expect(descriptor(sibling)).toMatchObject({value: 4, writable: true});
        expect(sibling.length).toBe(4);
        expect(descriptor(other.getData()).writable).toBe(true);
        history.disconnect();
    });

    test('a source swap and root replacement keep length and special array prototypes current', () => {
        const first = new Carburetor<number[]>([1]);
        const second = new Carburetor<number[]>([4, 5]);
        let current = first;
        const view = buildPersistentView(declare(() => current)) as number[];
        const length = (): PropertyDescriptor => Object.getOwnPropertyDescriptor(view, 'length')!;

        first.update(draft => { Object.defineProperty(draft, 'length', {writable: false}); });
        expect(length()).toMatchObject({value: 1, writable: true});
        current = second;
        expect(length()).toMatchObject({value: 2, writable: true});
        expect(view.length).toBe(2);

        const unusual = Object.setPrototypeOf([3, 4, 5], null) as number[];
        Object.defineProperty(unusual, 'length', {writable: false});
        second.setData(unusual);
        expect(Object.getPrototypeOf(view)).toBe(null);
        expect(length()).toMatchObject({value: 3, writable: true, configurable: false});
        expect(view.length).toBe(3);
        expect(Reflect.ownKeys(view)).toEqual(['0', '1', '2', 'length']);
        second.setData([10, 11, 12, 13]);
        expect(Object.getPrototypeOf(view)).toBe(Array.prototype);
        expect(length()).toMatchObject({value: 4, writable: true});
        expect(view.length).toBe(4);
    });

    test('detaching selected root and nested arrays keeps the raw length value (R30-04)', () => {
        const store = new Carburetor<number[]>([1, 2]);
        const view = buildPersistentView(declare(() => store)) as number[];
        store.update(draft => { Object.defineProperty(draft, 'length', {writable: false}); });

        const selected = detachSelection(view) as number[];
        expect(selected).not.toBe(store.getData());
        // R30-04: descriptor flags are not part of a selection — the copy is plain writable
        // data with the true length and elements.
        expect(selected.length).toBe(2);
        expect(Array.from(selected)).toEqual([1, 2]);
        expect(Object.getOwnPropertyDescriptor(selected, 'length'))
            .toMatchObject({value: 2, writable: true, configurable: false, enumerable: false});
        expect(Object.getOwnPropertyDescriptor(view, 'length')?.writable).toBe(true);

        const nested = new Carburetor({items: [3, 4]});
        const parent = buildPersistentView(declare(() => nested));
        nested.update(draft => { Object.defineProperty(draft.items, 'length', {value: 1, writable: false}); });
        const detached = detachSelection(parent) as {items: number[]};
        expect(detached.items.length).toBe(1);
        expect(detached.items[0]).toBe(3);
    });

    test('public connectSelection reuses the detached array while its content is unchanged (R30-04)', () => {
        const store = new Carburetor<number[]>([1, 2]);
        const history = new CarburetorHistory(store);

        class List extends AntiHookComponent {
            public readonly view = this.connect(() => store);
            public readonly selected = this.connectSelection(() => store, () => this.view);

            render(): null {
                return null;
            }
        }

        const component = new List({});
        const before = component.selected();
        expect(component.selected()).toBe(before);

        // A length lock is a descriptor change, not a selection change: the snapshot keeps
        // its identity (R30-04).
        store.update(draft => { Object.defineProperty(draft, 'length', {writable: false}); });
        expect(component.selected()).toBe(before);

        expect(history.undo()).toBe(true);
        expect(component.selected()).toBe(before);

        // A real content change is what produces a new snapshot.
        store.update(draft => { draft.push(3); });
        const grown = component.selected();
        expect(grown).not.toBe(before);
        expect(Array.from(grown as number[])).toEqual([1, 2, 3]);
        expect(component.selected()).toBe(grown);
        history.disconnect();
    });
});
