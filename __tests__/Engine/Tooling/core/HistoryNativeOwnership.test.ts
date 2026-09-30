import {Carburetor, CarburetorHistory, ResourceCache, ResourceCarburetor} from '@/Carburetor';

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

    test('a custom snapshot projection must supply its own authoritative history capture', () => {
        class Projected extends Carburetor<{value: number}> {
            public snapshot(): {value: number; wire: string} {
                return {...super.snapshot(), wire: 'private-state'};
            }
        }
        expect(() => new CarburetorHistory(new Projected({value: 1})))
            .toThrow(/custom snapshot.*provide captureHistory/);
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
});
