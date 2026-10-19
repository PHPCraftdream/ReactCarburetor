// Scalar writes rebuild nothing; uniquely owned topology is repaired locally. Opaque
// facade mutations still discard the index and rebuild on the next native read.
/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor} from "@/Carburetor";
import {nativeAliasIndex} from '@/Carburetor/Store/Tracking/Aliases/NativeAliasIndex';

interface IChild {n: number;}
interface IParent {child: IChild;}
class Box {
    /** Constructs a Box.
     *
     * @param child - child value held by the Box
     */
    public constructor(public child: IChild) {}
}
type NativeBox = Date & {child?: IChild};
interface INativeReplacementState {
    branch: IParent;
    rows: IChild[];
    map: Map<string, IParent | IChild[]>;
    set: Set<IParent>;
    box: Box | NativeBox | Map<string, IChild>;
    outer: Map<string, Map<string, IParent>>;
}
class Store extends Carburetor<INativeReplacementState> {
    /** Mutates the draft and publishes.
     *
     * @param mutate - draft mutation callback
     */
    public change(mutate: (draft: INativeReplacementState) => void): void { this.update(mutate); }
    /** Reads the Map member using the read facade. */
    public readFacadeParent(): IParent { return this.read(() => undefined).map.get('parent') as IParent; }
}

type Route = 'map' | 'read-map' | 'set-iterator' | 'set-forEach' | 'splice'
    | 'date-field' | 'nested-map' | 'map-in-map' | 'no-rebuild';

/** Runs a raw native mutation and checks subsequent subscription delivery.
 *
 * @param route - native access and replacement scenario
 */
const runCase = (route: Route): void => {
    const previousMode = process.env.NODE_ENV;
    try {
        process.env.NODE_ENV = 'production';
        const parent: IParent = {child: {n: 0}};
        const rows: IChild[] = [{n: 0}, {n: 1}];
        const store = new Store({
            branch: parent, rows, map: new Map<string, IParent | IChild[]>([['parent', parent], ['rows', rows]]),
            outer: new Map([['inner', new Map([['parent', parent]])]]),
            set: new Set([parent]), box: new Box({n: -1}),
        });
        const changes: number[] = [];
        const stop = store.watch(data => {
            const box = data.box;
            if (box instanceof Date) return (box as NativeBox).child!.n;
            if (box instanceof Map) return box.get('child')!.n;
            return box.child.n;
        }, next => { changes.push(next); });
        try {
            store.change(draft => {
                let raw: IParent;
                let map: Map<string, IParent | IChild[]> | undefined;
                let set: Set<IParent> | undefined;
                let outer: Map<string, Map<string, IParent>> | undefined;
                if (route === 'no-rebuild') {
                    raw = draft.map.get('parent') as IParent;
                } else {
                    map = draft.map;
                    set = draft.set;
                    if (route === 'map-in-map') outer = draft.outer;
                    expect(store.readFacadeParent()).toBe(parent);
                    if (route === 'map-in-map') raw = outer!.get('inner')!.get('parent')!;
                    else if (route === 'read-map') raw = store.readFacadeParent();
                    else if (route === 'set-iterator') raw = [...set][0];
                    else if (route === 'set-forEach') {
                        let member!: IParent;
                        set.forEach(value => { member = value; });
                        raw = member;
                    } else raw = map.get('parent') as IParent;
                }
                if (route === 'splice') {
                    const rawRows = map!.get('rows') as IChild[];
                    rawRows.splice(0, 1);
                    rawRows.push({n: 9});
                    draft.box = new Box(rawRows[0]);
                } else if (route === 'date-field') {
                    const child = {n: 1};
                    const date = new Date(1) as NativeBox;
                    date.child = child;
                    raw.child = child;
                    draft.box = date;
                } else if (route === 'nested-map') {
                    const child = {n: 1};
                    raw.child = child;
                    draft.box = new Map([['child', child]]);
                } else {
                    raw.child = {n: 1};
                    draft.box = new Box(raw.child);
                }
            });
            expect(changes).toEqual([1]);
            changes.length = 0;
            store.change(draft => {
                if (route === 'splice') draft.rows[0].n = 2;
                else draft.branch.child.n = 2;
            });
            expect(changes).toEqual([2]);
            if (route === 'splice') {
                changes.length = 0;
                store.change(draft => { draft.rows[1].n = 10; });
                expect(changes).toEqual([]);
            }
        } finally { stop(); }
    } finally {
        process.env.NODE_ENV = previousMode;
    }
};

describe('raw native member mutation followed by Box/native replacement', () => {
    test.each([
        'map', 'read-map', 'set-iterator', 'set-forEach', 'splice',
        'date-field', 'nested-map', 'map-in-map', 'no-rebuild',
    ] as const)('%s route preserves later alias notification', runCase);
});
interface IState {
    rows: {n: number}[];
    map: Map<number, {n: number}>;
}

class AliasIndexStore extends Carburetor<IState> {
    public writeScalar(): void {
        this.update(draft => { draft.rows[0].n += 1; });
    }

    public replaceRow(index: number, row: {n: number}): void {
        this.update(draft => { draft.rows[index] = row; });
    }

    public deleteRow(index: number): void {
        this.update(draft => { delete draft.rows[index]; });
    }

    public writeMapMember(index: number, row: {n: number}): void {
        this.update(draft => { draft.map.set(index, row); });
    }

    public readNative(): IState['map'] {
        return this.read(() => undefined).map;
    }
}

interface IBranchState {
    branch: {child: {n: number}};
    map: Map<string, {n: number}>;
}

class BranchStore extends Carburetor<IBranchState> {
    public readNative(): IBranchState['map'] {
        return this.read(() => undefined).map;
    }
}

const ROWS = 32;
const makeStore = (): {store: AliasIndexStore; root: IState} => {
    const rows = Array.from({length: ROWS}, (_, n) => ({n}));
    const root: IState = {rows, map: new Map(rows.map((row, index) => [index, row]))};
    return {store: new AliasIndexStore(root), root};
};

/** Counts indexRoot walks: ownership rebuilds reflect on every own key of the root. */
const withRootVisits = async (root: IState, run: () => Promise<void> | void): Promise<number> => {
    const original = Reflect.getOwnPropertyDescriptor;
    let visits = 0;
    Reflect.getOwnPropertyDescriptor = function (object: object, key: PropertyKey) {
        if (object === root) visits++;
        return original(object, key);
    };
    try {
        await run();
    } finally {
        Reflect.getOwnPropertyDescriptor = original;
    }
    return visits;
};

describe('native alias index freshness', () => {
    test('scalar reads and uniquely owned topology avoid rebuilds; opaque facade writes rebuild', async () => {
        const {store, root} = makeStore();
        expect(store.readNative().get(0)).toBeDefined();

        const scalarVisits = await withRootVisits(root, () => {
            for (let cycle = 0; cycle < 4; cycle++) {
                store.writeScalar();
                if (store.readNative().get(1) === undefined) throw new Error('Map member lost');
            }
        });
        expect(scalarVisits).toBe(0);

        const topologyVisits = await withRootVisits(root, () => {
            store.replaceRow(2, {n: -2});
            expect(store.readNative().get(2)).toBeDefined();
        });
        // Replacement and deletion touch only the changed row, never the root.
        expect(topologyVisits).toBe(0);

        const deleteVisits = await withRootVisits(root, () => {
            store.deleteRow(3);
            expect(store.readNative().get(3)).toBeDefined();
        });
        expect(deleteVisits).toBe(0);

        const facadeVisits = await withRootVisits(root, () => {
            store.writeMapMember(4, {n: -4});
            expect(store.readNative().get(4)).toBeDefined();
        });
        expect(facadeVisits).toBeGreaterThan(0);
    });

    test('an opaque handout rebuilds the index before a raw-handed descendant is mapped', () => {
        const parent = {child: {n: 0}};
        const store = new BranchStore({
            branch: parent, map: new Map<string, {n: number}>([['parent', parent]]),
        });
        store.readNative().get('parent');
        store.update(draft => {
            const raw = draft.map.get('parent');
            raw.child = {n: 1};
            draft.map.set('leaf', raw.child);
        });

        const changes: number[] = [];
        const stop = store.watch(
            data => (data.map.get('leaf') as {n: number}).n,
            next => { changes.push(next); }
        );
        try {
            expect(changes).toEqual([]);
            store.update(draft => { draft.branch.child.n = 2; });
            expect(changes).toEqual([2]);
        } finally {
            stop();
        }
    });

    test('aliases recorded after scalar writes still wake a subscribed selection', () => {
        const {store} = makeStore();
        const changes: number[] = [];
        const stop = store.watch(
            data => (data.map.get(0) as {n: number}).n,
            next => { changes.push(next); }
        );
        try {
            store.writeScalar();
            expect(changes).toEqual([1]);
            store.replaceRow(0, {n: 40});
            expect((store.readNative().get(0) as {n: number}).n).toBe(1);
            store.writeMapMember(0, {n: 41});
            expect(changes).toEqual([1, 41]);
        } finally {
            stop();
        }
    });
});

test('ordinary Date row assignments preserve the warmed native alias index', () => {
    interface IDateRow {due: Date; value: number;}
    interface IDateState {rows: IDateRow[]; map: Map<string, IDateRow[]>;}
    class DateStore extends Carburetor<IDateState> {
        public setDue(value: number): void {
            this.update(draft => { draft.rows[0].due = new Date(value); });
        }
        public readNative(): IDateState['map'] {
            return this.read(() => undefined).map;
        }
    }
    const rows = Array.from({length: 1000}, (_, value) => ({due: new Date(value), value}));
    const root: IDateState = {rows, map: new Map([['rows', rows]])};
    const store = new DateStore(root);
    expect(store.readNative().get('rows')).toBeDefined();
    const generation = nativeAliasIndex.generation(root);
    const rowsRead = store.readNative().get('rows');
    const original = Reflect.getOwnPropertyDescriptor;
    let rootVisits = 0;
    Reflect.getOwnPropertyDescriptor = function (object: object, key: PropertyKey) {
        if (object === root) rootVisits++;
        return original(object, key);
    };
    try {
        for (let value = 0; value < 1000; value++) {
            store.setDue(value);
            const rowsAfterWrite = store.readNative().get('rows');
            if (rowsAfterWrite !== rowsRead) throw new Error('Native rows identity changed');
        }
    } finally {
        Reflect.getOwnPropertyDescriptor = original;
    }
    const generationDelta = nativeAliasIndex.generation(root) - generation;
    expect(store.getData().rows[0].due.getTime()).toBe(999);
    expect({generationDelta, rootVisits}).toEqual({generationDelta: 0, rootVisits: 0});
});

test.each(['map', 'set', 'box', 'own-field-date', 'date-subclass'] as const)(
    'opaque %s replacement invalidates a warmed ownership index', kind => {
        interface IState {value: unknown; leaf: {n: number};}
        class DateSubclass extends Date {}
        class NativeStore extends Carburetor<IState> {
            public replace(value: unknown): void { this.update(draft => { draft.value = value; }); }
        }
        const leaf = {n: 1};
        const root: IState = {value: new Map([['old', leaf]]), leaf};
        const store = new NativeStore(root);
        const warmed = nativeAliasIndex.paths(root);
        const generation = nativeAliasIndex.generation(root);
        const values: Record<typeof kind, unknown> = {
            map: new Map([['leaf', leaf]]), set: new Set([leaf]), box: new Box(leaf),
            'own-field-date': Object.assign(new Date(1), {leaf}), 'date-subclass': new DateSubclass(1),
        };
        store.replace(values[kind]);
        expect(nativeAliasIndex.generation(root)).toBe(generation + 1);
        const rebuilt = nativeAliasIndex.paths(root);
        expect(rebuilt).not.toBe(warmed);
        expect(rebuilt.get(leaf)).toEqual(['leaf']);
    }
);

test('ordinary Date replaces a trackable value through local ownership repair', () => {
    interface IState {value: {n: number} | Date;}
    class DateStore extends Carburetor<IState> {
        public replace(): void { this.update(draft => { draft.value = new Date(1); }); }
    }
    const previous = {n: 1};
    const root: IState = {value: previous};
    const store = new DateStore(root);
    const warmed = nativeAliasIndex.paths(root);
    const generation = nativeAliasIndex.generation(root);
    store.replace();
    expect(nativeAliasIndex.generation(root)).toBe(generation + 1);
    const updated = nativeAliasIndex.paths(root);
    expect(updated).toBe(warmed);
    expect(updated.has(previous)).toBe(false);
});

test('ordinary Date replacement of native value preserves the warmed ownership index', () => {
    interface IState {value: Map<string, {n: number}> | Date; leaf: {n: number};}
    class DateStore extends Carburetor<IState> {
        public replace(): void {
            this.update(draft => { draft.value = new Date(1); });
        }
    }
    const leaf = {n: 1};
    const root: IState = {value: new Map([['leaf', leaf]]), leaf};
    const store = new DateStore(root);
    const warmed = nativeAliasIndex.paths(root);
    const generation = nativeAliasIndex.generation(root);
    store.replace();
    expect(nativeAliasIndex.generation(root)).toBe(generation);
    expect(nativeAliasIndex.paths(root)).toBe(warmed);
    expect(nativeAliasIndex.paths(root).get(leaf)).toEqual(['leaf']);
});
