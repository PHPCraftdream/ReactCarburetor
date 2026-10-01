import {
    Carburetor, CarburetorHistory, ComponentUpdateThrottle, EResourceStatus, ResourceCache, ResourceCarburetor,
} from '@/Carburetor';

type Native = Map<string, number> | Set<number> | Date;

const makeNative = (kind: string, value: number): Native => {
    if (kind === 'map') return new Map([['k', value]]);
    if (kind === 'set') return new Set([value]);
    return new Date(value);
};

const readNative = (native: Native): number => {
    if (native instanceof Map) return native.get('k') as number;
    if (native instanceof Set) return [...native][0];
    return native.getTime();
};

const mutateNative = (native: Native, value: number): void => {
    if (native instanceof Map) native.set('k', value);
    else if (native instanceof Set) { native.clear(); native.add(value); }
    else native.setTime(value);
};

class Root extends Carburetor<Native> {
    public change(value: number): void {
        this.update(draft => { mutateNative(draft, value); });
    }
}

class Nested extends Carburetor<{native: Native; other: number}> {
    public change(value: number): void {
        this.update(draft => { mutateNative(draft.native, value); });
    }
    public replace(native: Native): void {
        this.update(draft => { draft.native = native; });
    }
    public changeOther(value: number): void {
        this.update(draft => { draft.other = value; });
    }
}

class Tree extends Carburetor<{node: {member: Map<string, number>}}> {
    public replace(member: Map<string, number>): void {
        this.update(draft => { draft.node = {member}; });
    }
}

class Graph extends Carburetor<Map<unknown, unknown>> {
    public change(value: number): void {
        this.update(draft => { draft.set('k', value); });
    }
}

interface IAliasedState {
    key: {id: string};
    map: Map<object, string>;
}

class Aliased extends Carburetor<IAliasedState> {
    public change(value: string): void {
        const key = this.getData().key;
        this.update(draft => { draft.map.set(key, value); });
    }
    public replace(map: Map<object, string>): void {
        this.update(draft => { draft.map = map; });
    }
    public rename(id: string): void {
        this.update(draft => { draft.key.id = id; });
    }
}

const expectLinked = (state: IAliasedState, value: string, id: string): void => {
    expect(state.key.id).toBe(id);
    expect(state.map.get(state.key)).toBe(value);
    expect(Object.getOwnPropertyDescriptor(state.map, 'owner')).toMatchObject({
        value: state, enumerable: false, configurable: true, writable: false,
    });
};

class NativeResource extends ResourceCarburetor<Map<object, string>, string> {
    public link(value: string): void {
        const owner = this.getData();
        this.update(draft => {
            if (!(draft.data instanceof Map)) throw new Error('expected loaded Map');
            draft.data.set(owner, value);
        });
    }
}

class NativeCache extends ResourceCache<Map<object, string>, string> {
    public link(value: string): void {
        const key = this.keyOf('a');
        const owner = this.getData().entries[key];
        this.update(draft => {
            const map = draft.entries[key].data;
            if (!(map instanceof Map)) throw new Error('expected loaded Map');
            map.set(owner, value);
        });
    }
    public ownedEntry(): {entry: object; map: Map<object, string>} {
        const entry = this.getData().entries[this.keyOf('a')];
        if (!(entry.data instanceof Map)) throw new Error('expected loaded Map');
        return {entry, map: entry.data};
    }
}


describe('native history endpoint ownership', () => {
    test('readonly plain endpoints replay their values and exact owned flags on repeated undo/redo', () => {
        const store = new Carburetor({first: 0, row: {n: 1}});
        const history = new CarburetorHistory(store);
        const replacement = {first: 2, row: {n: 3}};
        Object.defineProperty(replacement.row, 'n', {
            value: 3, writable: false, enumerable: true, configurable: true,
        });
        store.setData(replacement);
        const seen: number[] = [];
        const stop = store.watch(data => data.row.n, n => { seen.push(n); });
        for (let i = 0; i < 3; i++) {
            expect(history.undo()).toBe(true);
            expect(store.getData().row.n).toBe(1);
            expect(Object.getOwnPropertyDescriptor(store.getData().row, 'n')?.writable).toBe(true);
            expect(history.redo()).toBe(true);
            expect(store.getData().row.n).toBe(3);
            expect(Object.getOwnPropertyDescriptor(store.getData().row, 'n')?.writable).toBe(false);
        }
        expect(seen).toEqual([1, 3, 1, 3, 1, 3]);
        stop();
        history.disconnect();
    });

    test('readonly owned endpoints keep native aliases and flags across independent history cursors', () => {
        const old = {n: 1};
        const initial = {row: old, map: new Map([['row', old]])};
        const store = new Carburetor(initial);
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        const newer = {n: 2};
        Object.defineProperty(newer, 'n', {
            value: 2, writable: false, enumerable: true, configurable: true,
        });
        store.setData({row: newer, map: new Map([['row', newer]])});
        for (let i = 0; i < 2; i++) {
            expect(first.undo()).toBe(true);
            expect(store.getData().row.n).toBe(1);
            expect(store.getData().map.get('row')).toBe(store.getData().row);
            expect(first.redo()).toBe(true);
            expect(store.getData().map.get('row')).toBe(store.getData().row);
            expect(Object.getOwnPropertyDescriptor(store.getData().row, 'n')?.writable).toBe(false);
        }
        expect(second.canUndo()).toBe(true);
        second.clear();
        expect(second.canUndo()).toBe(false);
        expect(first.undo()).toBe(true);
        expect(store.getData().map.get('row')).toBe(store.getData().row);
        first.disconnect();
        second.disconnect();
    });

    test.each([EResourceStatus.Idle, EResourceStatus.Success, EResourceStatus.Error])(
        'owned resource replay retains readonly unchanged %s status', status => {
            const resource = new ResourceCarburetor(async () => 'answer');
            const history = new CarburetorHistory(resource);
            const next = {...resource.getData(), status, updatedAt: 7,
                data: status === EResourceStatus.Success ? 'saved' : undefined,
                error: status === EResourceStatus.Error ? 'failed' : undefined};
            Object.defineProperty(next, 'status', {
                value: status, writable: false, configurable: false, enumerable: true,
            });
            resource.setData(next);
            for (let replay = 0; replay < 2; replay++) {
                expect(history.undo()).toBe(true);
                expect(resource.getData().status).toBe(EResourceStatus.Idle);
                expect(history.redo()).toBe(true);
                expect(resource.getData()).toMatchObject({status, updatedAt: 7});
                expect(Object.getOwnPropertyDescriptor(resource.getData(), 'status')).toMatchObject({
                    value: status, writable: false, configurable: false,
                });
                expect(history.canUndo()).toBe(true);
                expect(history.canRedo()).toBe(false);
            }
            history.disconnect();
        }
    );

    test.each(['map', 'set', 'date'])('%s root in-place edits publish exact undo/redo without changing snapshot contract', kind => {
        const original = makeNative(kind, 1);
        const store = new Root(original);
        const history = new CarburetorHistory(store);
        const ordinarySnapshot = store.snapshot();
        let publications = 0;
        const subscription = store.subscribe(() => { publications++; });
        store.change(2);
        expect(ordinarySnapshot).toBe(original);
        expect(readNative(ordinarySnapshot)).toBe(2);
        expect(history.undo()).toBe(true);
        expect(readNative(store.getData())).toBe(1);
        expect(history.redo()).toBe(true);
        expect(readNative(store.getData())).toBe(2);
        expect(publications).toBe(3);
        store.unsubscribe(subscription);
        history.disconnect();
    });

    test.each(['map', 'set', 'date'])('%s nested in-place edits retain both endpoints across repeated replay and branching', kind => {
        const initial = makeNative(kind, 1);
        const store = new Nested({native: initial, other: 0});
        const history = new CarburetorHistory(store);
        const snapshot = store.snapshot();
        store.change(2);
        expect(snapshot.native).toBe(initial);
        expect(readNative(snapshot.native)).toBe(2);
        for (let i = 0; i < 3; i++) {
            expect(history.undo()).toBe(true);
            expect(readNative(store.getData().native)).toBe(1);
            expect(history.redo()).toBe(true);
            expect(readNative(store.getData().native)).toBe(2);
        }
        store.change(3);
        expect(history.undo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(2);
        expect(history.undo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(1);
        expect(history.redo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(2);
        store.changeOther(7);
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(store.getData().other).toBe(0);
        history.disconnect();
    });

    test('replacement patch and plain subtree own their native payload before external mutations and replay', () => {
        const original = new Map([['k', 1]]);
        const replacement = new Map([['k', 2]]);
        const store = new Nested({native: original, other: 0});
        const history = new CarburetorHistory(store);
        store.replace(replacement);
        original.set('k', 8);
        replacement.set('k', 9);
        expect(history.undo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(1);
        expect(history.redo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(2);
        const replayed = store.getData().native;
        expect(replayed).toBeInstanceOf(Map);
        if (replayed instanceof Map) replayed.set('k', 10);
        expect(history.undo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(1);
        expect(history.redo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(2);
        history.disconnect();

        const inner = new Map([['k', 3]]);
        const subtree = new Tree({node: {member: new Map([['k', 1]])}});
        const subtreeHistory = new CarburetorHistory(subtree);
        subtree.replace(inner);
        inner.set('k', 4);
        expect(subtreeHistory.undo()).toBe(true);
        expect(subtree.getData().node.member.get('k')).toBe(1);
        expect(subtreeHistory.redo()).toBe(true);
        expect(subtree.getData().node.member.get('k')).toBe(3);
        subtreeHistory.disconnect();
    });

    test('plain Map keys and native descriptor links back to the root stay live across replay and branches', () => {
        const key = {id: 'original'};
        const state: IAliasedState = {key, map: new Map([[key, 'one']])};
        Object.defineProperty(state.map, 'owner', {
            value: state, enumerable: false, configurable: true, writable: false,
        });
        const store = new Aliased(state);
        const history = new CarburetorHistory(store);
        store.change('two');
        expect(history.undo()).toBe(true);
        expectLinked(store.getData(), 'one', 'original');
        expect(history.redo()).toBe(true);
        expectLinked(store.getData(), 'two', 'original');
        const replacement = new Map<object, string>([[store.getData().key, 'three']]);
        Object.defineProperty(replacement, 'owner', {
            value: store.getData(), enumerable: false, configurable: true, writable: false,
        });
        store.replace(replacement);
        replacement.set(store.getData().key, 'unpublished');
        expect(history.undo()).toBe(true);
        expectLinked(store.getData(), 'two', 'original');
        expect(history.redo()).toBe(true);
        expectLinked(store.getData(), 'three', 'original');
        store.rename('renamed');
        expect(history.undo()).toBe(true);
        expectLinked(store.getData(), 'three', 'original');
        expect(history.redo()).toBe(true);
        expectLinked(store.getData(), 'three', 'renamed');
        history.disconnect();
    });

    test('opaque array-prototype object aliases keep their whole-graph replay classification', () => {
        const key = {id: 1};
        const opaque: {key: typeof key} = Object.assign(Object.create(Array.prototype), {key});
        const store = new Carburetor({key, opaque});
        const history = new CarburetorHistory(store);
        store.setData({key: {id: 2}, opaque});
        expect(store.getData().key).not.toBe(store.getData().opaque.key);
        expect(history.undo()).toBe(true);
        expect(store.getData().key).toBe(store.getData().opaque.key);
        expect(store.getData().key.id).toBe(1);
        expect(history.redo()).toBe(true);
        expect(store.getData().key.id).toBe(2);
        expect(store.getData().opaque.key.id).toBe(1);
        expect(store.getData().key).not.toBe(store.getData().opaque.key);
        history.disconnect();
    });

    test('a patch after an opaque snapshot cannot rewrite that saved endpoint', () => {
        const store = new Carburetor({count: 0});
        const history = new CarburetorHistory(store);
        store.setData(Object.assign(Object.create(null), {count: 1}));
        store.setData(Object.assign(Object.create(null), {count: 2}));
        expect(history.undo()).toBe(true);
        expect(store.getData().count).toBe(1);
        expect(history.undo()).toBe(true);
        expect(store.getData().count).toBe(0);
        expect(history.redo()).toBe(true);
        expect(store.getData().count).toBe(1);
        expect(history.redo()).toBe(true);
        expect(store.getData().count).toBe(2);
        history.disconnect();
    });

    test('another history records an owned native replay as its own fresh publication', () => {
        const key = {id: 'k'};
        const state: IAliasedState = {key, map: new Map([[key, 'one']])};
        Object.defineProperty(state.map, 'owner', {value: state, configurable: true});
        const store = new Aliased(state);
        const first = new CarburetorHistory(store);
        const second = new CarburetorHistory(store);
        store.change('two');
        expect(first.undo()).toBe(true);
        expectLinked(store.getData(), 'one', 'k');
        expect(second.undo()).toBe(true);
        expectLinked(store.getData(), 'two', 'k');
        expect(first.canRedo()).toBe(false);
        first.disconnect();
        second.disconnect();
    });

    test('native descriptors, self-cycles and aliases survive owned replay', () => {
        const map = new Map<unknown, unknown>();
        const child = {n: 1};
        map.set(map, child);
        map.set('alias', child);
        Object.defineProperty(map, 'self', {value: map, enumerable: false, configurable: true, writable: false});
        const store = new Graph(map);
        const history = new CarburetorHistory(store);
        store.change(2);
        expect(history.undo()).toBe(true);
        const owned = store.getData();
        expect(owned).not.toBe(map);
        expect(owned.get(owned)).toBe(owned.get('alias'));
        expect(owned.get(owned)).not.toBe(child);
        expect(Object.getOwnPropertyDescriptor(owned, 'self')).toMatchObject({
            value: owned, enumerable: false, configurable: true, writable: false,
        });
        expect(history.redo()).toBe(true);
        expect(owned.has('k')).toBe(false);
        expect(store.getData().get('k')).toBe(2);
        history.disconnect();
    });

    test('resource wire key and cache entries retain native backlinks across owned replay', async () => {
        const resource = new NativeResource(async () => new Map<object, string>());
        const resourceHistory = new CarburetorHistory(resource);
        await resource.load('a');
        const loaded = resource.getData().data;
        if (!(loaded instanceof Map)) throw new Error('expected loaded Map');
        Object.defineProperty(loaded, 'owner', {value: resource.getData(), configurable: true});
        resource.link('one');
        resource.link('two');
        for (const [action, value] of [
            ['undo', 'one'], ['redo', 'two'],
        ] as const) {
            expect(resourceHistory[action]()).toBe(true);
            const state = resource.getData();
            if (!(state.data instanceof Map)) throw new Error('expected replayed Map');
            expect(state.data.get(state)).toBe(value);
            expect(Object.getOwnPropertyDescriptor(state.data, 'owner')?.value).toBe(state);
            expect(resource.snapshot().key).toBe(JSON.stringify('a'));
            expect(resource.getData()).not.toHaveProperty('key');
        }
        resourceHistory.disconnect();

        const cache = new NativeCache(async () => new Map<object, string>());
        const cacheHistory = new CarburetorHistory(cache);
        await cache.load('a');
        const initial = cache.ownedEntry();
        Object.defineProperty(initial.map, 'owner', {value: initial.entry, configurable: true});
        cache.link('one');
        cache.link('two');
        for (const [action, value] of [
            ['undo', 'one'], ['redo', 'two'],
        ] as const) {
            expect(cacheHistory[action]()).toBe(true);
            const {entry, map} = cache.ownedEntry();
            expect(map.get(entry)).toBe(value);
            expect(Object.getOwnPropertyDescriptor(map, 'owner')?.value).toBe(entry);
        }
        cacheHistory.disconnect();
    });

    test('a subclass overriding snapshot() for logging can still attach a history', () => {
        const seen: number[] = [];

        class Logged extends Carburetor<{value: number}> {
            public snapshot(): {value: number} {
                const copy = super.snapshot();
                seen.push(copy.value);

                return copy;
            }
        }

        const store = new Logged({value: 1});
        const history = new CarburetorHistory(store);

        store.update(draft => { draft.value = 2; });
        store.snapshot();

        expect(history.undo()).toBe(true);
        expect(store.getData().value).toBe(1);
        expect(seen).toEqual([2]);

        history.disconnect();
    });

    test('unsupported class instances and accessors are rejected rather than promising a false undo', () => {
        class Box { public constructor(public value: number) {} }
        expect(() => new CarburetorHistory(new Carburetor({box: new Box(1)})))
            .toThrow(/cannot own a mutable class instance/);
        const map = new Map([['k', 1]]);
        let getterCalls = 0;
        Object.defineProperty(map, 'hidden', {get: () => { getterCalls++; return 1; }});
        expect(() => new CarburetorHistory(new Root(map))).toThrow(/cannot snapshot accessor property/);
        expect(getterCalls).toBe(0);
    });
    test.each(['map', 'set', 'date'])('%s native read and equal-content operation do not claim undo', kind => {
        const store = new Root(makeNative(kind, 1));
        const history = new CarburetorHistory(store);
        store.update(draft => {
            if (draft instanceof Map) {
                void draft.get('k');
                draft.set('k', 1);
            } else if (draft instanceof Set) {
                void draft.has(1);
                draft.add(1);
            } else {
                void draft.getTime();
                draft.setTime(1);
            }
        });
        expect(history.canUndo()).toBe(false);
        expect(history.undo()).toBe(false);
        store.change(2);
        expect(history.undo()).toBe(true);
        expect(readNative(store.getData())).toBe(1);
        history.disconnect();
    });

    test('nested native reads do not erase redo, but a native mutation does', () => {
        class Reading extends Nested {
            public inspect(): void {
                this.update(draft => { void (draft.native as Map<string, number>).get('k'); });
            }
        }
        const store = new Reading({native: new Map([['k', 1]]), other: 0});
        const history = new CarburetorHistory(store);
        store.change(2);
        expect(history.undo()).toBe(true);
        store.inspect();
        expect(history.canRedo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(readNative(store.getData().native)).toBe(2);
        history.disconnect();
    });

    test('native topology, descriptor flags and sparse symbol fields distinguish endpoints', () => {
        const alias = {id: 1};
        const key = Symbol('field');
        const map = new Map<unknown, unknown>([['one', alias], ['two', alias]]);
        const list: unknown[] = [];
        list.length = 2;
        list[1] = undefined;
        const root = {alias, map, list};
        Object.defineProperty(map, 'owner', {value: root, configurable: true});
        const store = new Carburetor(root);
        const history = new CarburetorHistory(store);
        store.update(draft => { draft.map.set('two', {id: 1}); });
        expect(history.undo()).toBe(true);
        expect(store.getData().map.get('one')).toBe(store.getData().map.get('two'));
        expect(history.redo()).toBe(true);
        expect(store.getData().map.get('one')).not.toBe(store.getData().map.get('two'));
        store.update(draft => {
            Object.defineProperty(draft.map, 'owner', {value: root, configurable: false});
        });
        expect(history.undo()).toBe(true);
        expect(Object.getOwnPropertyDescriptor(store.getData().map, 'owner')?.configurable).toBe(true);
        store.update(draft => { draft.map.set(key, undefined); });
        expect(history.undo()).toBe(true);
        expect(store.getData().map.has(key)).toBe(false);
        store.update(draft => { draft.list[0] = undefined; });
        expect(history.undo()).toBe(true);
        expect(0 in store.getData().list).toBe(false);
        history.disconnect();
    });
    test('Set order is observable, while invalid Date time equals itself', () => {
        const set = new Carburetor(new Set([1, 2]));
        const setHistory = new CarburetorHistory(set);
        set.update(draft => {
            draft.delete(1);
            draft.add(1);
        });
        expect([...set.getData()]).toEqual([2, 1]);
        expect(setHistory.undo()).toBe(true);
        expect([...set.getData()]).toEqual([1, 2]);
        setHistory.disconnect();

        const date = new Carburetor(new Date(NaN));
        const dateHistory = new CarburetorHistory(date);
        date.update(draft => { void draft.getTime(); });
        expect(dateHistory.undo()).toBe(false);
        date.update(draft => { draft.setTime(9); });
        expect(dateHistory.undo()).toBe(true);
        expect(Number.isNaN(date.getData().getTime())).toBe(true);
        dateHistory.disconnect();
    });
    test('queued native mutation settles before undo across independent histories', () => {
        class ManualThrottle extends ComponentUpdateThrottle {
            protected setupTimeout(): void {}
            public flush(): void { this.letsUpdate(); }
        }
        const throttle = new ManualThrottle();
        const store = new Root(new Map([['k', 0]]), throttle);
        const first = new CarburetorHistory(store);
        const other = new CarburetorHistory(store);
        store.change(1);
        throttle.flush();
        store.change(2);
        expect(first.undo()).toBe(true);
        expect(readNative(store.getData())).toBe(1);
        throttle.flush();
        expect(first.canRedo()).toBe(true);
        expect(other.undo()).toBe(true);
        expect(readNative(store.getData())).toBe(0);
        throttle.flush();
        expect(first.canRedo()).toBe(false);
        first.disconnect();
        other.disconnect();
    });
});
