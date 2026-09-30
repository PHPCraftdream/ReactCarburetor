// Native collection members remain raw. These tests exercise the other supported write path
// to the same plain object, not a mutation of the raw Map/Set behind the store's back.
/* oxlint-disable carburetor/no-untrackable-store-data */
import {Carburetor, Computed} from "@/Carburetor";
import {TReadonly} from "@/Carburetor/Models/Base";

interface IState {
    row: {n: number};
    other: {n: number};
    map: Map<unknown, unknown>;
    set: Set<unknown>;
}

class NativeAliasStore extends Carburetor<IState> {
    public put(n: number): void {
        this.update(draft => { draft.row.n = n; });
    }

    public putOther(n: number): void {
        this.update(draft => { draft.other.n = n; });
    }

    public replaceRow(row: {n: number}): void {
        this.update(draft => { draft.row = row; });
    }

    public replaceMapValue(value: object): void {
        this.update(draft => { draft.map.set('row', value); });
    }
    public change(mutate: (draft: IState) => void): void {
        this.update(mutate);
    }

    public publishRaw(): void {
        this.emitUpdate();
    }
}

const makeStore = (): NativeAliasStore => {
    const row = {n: 1};
    return new NativeAliasStore({
        row, other: {n: 0}, map: new Map([['row', row]]), set: new Set([row]),
    });
};

describe('raw native members with ordinary writable aliases', () => {
    test('Map.get selection wakes watch and subscribed Computed, but not on an unrelated branch', () => {
        const store = makeStore();
        const changes: number[] = [];
        const stop = store.watch(
            data => (data.map.get('row') as {n: number}).n,
            next => { changes.push(next); }
        );
        let evaluations = 0;
        const derived = new Computed(get => {
            evaluations++;
            return (get(store).map.get('row') as {n: number}).n;
        });
        let wakes = 0;
        const id = derived.subscribe(() => { wakes++; });

        expect(derived.get()).toBe(1);
        store.putOther(3);
        expect(evaluations).toBe(1);
        expect(wakes).toBe(0);
        expect(changes).toEqual([]);

        store.put(2);
        expect(changes).toEqual([2]);
        expect(derived.get()).toBe(2);
        expect(evaluations).toBe(2);
        expect(wakes).toBe(1);
        stop();
        derived.unsubscribe(id);
    });

    test('native-first and raw-first reads record live ordinary paths, including nested aliases', () => {
        const store = makeStore();
        const raw = store.getData().row;
        const nativeFirst = new Set<string>();
        const first = store.read(path => nativeFirst.add(path));
        expect(first.map.get('row')).toBe(raw);
        expect(nativeFirst).toEqual(new Set(['map', 'row']));

        const rawFirst = new Set<string>();
        const second = store.read(path => rawFirst.add(path));
        expect(second.row.n).toBe(1);
        expect(second.map.get('row')).toBe(raw);
        expect(rawFirst.has('row')).toBe(true);
        expect(rawFirst.has('row.n')).toBe(true);
        expect([...second.set][0]).toBe(raw);

        const nested = {child: {n: 5}};
        store.replaceMapValue(nested);
        // There is no plain path for this new object: its member must not subscribe to row.
        const detachedReads = new Set<string>();
        const detached = store.read(path => detachedReads.add(path)).map.get('row') as typeof nested;
        expect(detached.child.n).toBe(5);
        expect(detachedReads.has('row')).toBe(false);
        store.replaceRow(nested.child);
        const retargetedReads = new Set<string>();
        const view = store.read(path => retargetedReads.add(path));
        const retargeted = view.map.get('row') as typeof nested;
        expect(retargeted.child).toBe(store.getData().row);
        expect(retargetedReads.has('row')).toBe(true);
        const changes: number[] = [];
        const stop = store.watch(data => {
            const member = data.map.get('row') as typeof nested;
            return member.child.n;
        }, next => { changes.push(next); });
        store.put(6);
        expect(changes).toEqual([6]);
        stop();
    });

    test('Set iteration, Map keys, forEach and native own data expose canonical plain aliases', () => {
        const row = {n: 1};
        const map = new Map<unknown, unknown>([['row', row], [row, 'key']]);
        Object.defineProperty(map, 'link', {
            value: {child: row}, configurable: true, enumerable: true,
        });
        const store = new NativeAliasStore({
            row, other: {n: 0}, map, set: new Set([row]),
        });
        const raw = store.getData().row;
        const read = (select: (view: TReadonly<IState>) => unknown): Set<string> => {
            const paths = new Set<string>();
            select(store.read(path => paths.add(path)));
            return paths;
        };
        expect(read(view => [...view.map.keys()]).has('row')).toBe(true);
        expect(read(view => [...view.set][0]).has('row')).toBe(true);
        expect(read(view => view.set.forEach(member => { expect(member).toBe(raw); })).has('row')).toBe(true);
        expect(read(view => {
            const linked = view.map as Map<unknown, unknown> & {link: {child: object}};
            return linked.link.child;
        }).has('row')).toBe(true);

        const reads = read(view => view.map.size);
        expect(reads).toEqual(new Set(['map']));
        const selected = read(view => view.map.get('row'));
        expect(selected.has('row')).toBe(true);
        const baseline = store.getVersion();
        store.putOther(4);
        expect(store.hasDriftSince(baseline, selected)).toBe(false);
        store.put(2);
        expect(store.hasDriftSince(baseline, selected)).toBe(true);
        let renders = 0;
        store.subscribe(() => { renders++; }, {reads: selected});
        store.putOther(5);
        expect(renders).toBe(0);
        store.put(3);
        expect(renders).toBe(1);
    });

    test('key, Set member and native own-field selections wake on the plain path, not on a sibling', () => {
        const row = {n: 1};
        const map = new Map<unknown, unknown>([[row, 7]]);
        Object.defineProperty(map, 'link', {value: row, enumerable: true, configurable: true});
        const store = new NativeAliasStore({
            row, other: {n: 0}, map, set: new Set([row]),
        });
        const events: number[][] = [[], [], [], []];
        const stopKey = store.watch(view => {
            const key = [...view.map.keys()][0] as typeof row;
            return key.n;
        }, n => { events[0].push(n); });
        const stopSet = store.watch(view => {
            const member = [...view.set][0] as typeof row;
            return member.n;
        }, n => { events[1].push(n); });
        const stopEach = store.watch(view => {
            let member: unknown;
            view.set.forEach(value => { member = value; });
            return (member as typeof row).n;
        }, n => { events[2].push(n); });
        const stopOwn = store.watch(view => {
            const linked = view.map as Map<unknown, unknown> & {link: typeof row};
            return linked.link.n;
        }, n => { events[3].push(n); });

        store.putOther(8);
        expect(events).toEqual([[], [], [], []]);
        store.put(2);
        expect(events).toEqual([[2], [2], [2], [2]]);
        stopKey();
        stopSet();
        stopEach();
        stopOwn();
    });

    test('native root backlinks are genuinely coarse without changing entry identity', () => {
        const row = {n: 1};
        const root: IState = {
            row, other: {n: 0}, map: new Map([['row', row]]), set: new Set([row]),
        };
        root.map.set('root', root);
        const backlink = Symbol('native-own-root');
        Object.defineProperty(root.map, backlink, {value: root, configurable: true});
        root.set.add(root);
        const store = new NativeAliasStore(root);
        const reads = new Set<string>();
        const view = store.read(path => reads.add(path));
        expect(view.map.get('root')).toBe(store.getData());
        expect(reads.has('*')).toBe(true);
        const ownReads = new Set<string>();
        const ownView = store.read(path => ownReads.add(path));
        expect(Reflect.get(ownView.map, backlink)).toBe(root);
        expect(ownReads.has('*')).toBe(true);
        const setReads = new Set<string>();
        const setView = store.read(path => setReads.add(path));
        expect([...setView.set][1]).toBe(root);
        expect(setReads.has('*')).toBe(true);
        let wakes = 0;
        store.subscribe(() => { wakes++; }, {reads});
        store.putOther(7);
        expect(wakes).toBe(1);
    });
});

describe('native ownership after live topology changes', () => {
    test.each(['set', 'define'])('equal-content %s replacement refreshes native ownership', kind => {
        const old = {n: 1};
        const newer = {n: 1};
        const store = new NativeAliasStore({
            row: old, other: {n: 0},
            map: new Map([['old', old], ['new', newer]]), set: new Set(),
        });
        const seed = store.watch(data => (data.map.get('old') as typeof old).n, () => {});
        if (kind === 'set') store.replaceRow(newer);
        else store.change(draft => {
            Object.defineProperty(draft, 'row', {
                value: newer, writable: true, enumerable: true, configurable: true,
            });
        });
        expect(store.getVersion()).toBe(kind === 'set' ? 0 : 1);
        const seen: number[] = [];
        const stop = store.watch(data => (data.map.get('new') as typeof newer).n,
            n => { seen.push(n); });
        store.put(2);
        expect(store.getData().map.get('new')).toBe(store.getData().row);
        expect(seen).toEqual([2]);
        stop();
        seed();
    });

    test('refused identity replacement leaves the seeded native ownership usable', () => {
        const old = {n: 1};
        const newer = {n: 1};
        const state = {
            row: old, other: {n: 0},
            map: new Map([['old', old], ['new', newer]]), set: new Set<typeof old>(),
        };
        Object.defineProperty(state, 'row', {
            value: old, writable: false, enumerable: true, configurable: true,
        });
        const store = new NativeAliasStore(state);
        const seen: number[] = [];
        const stop = store.watch(data => (data.map.get('old') as typeof old).n,
            n => { seen.push(n); });
        expect(() => store.replaceRow(newer)).toThrow(TypeError);
        expect(store.getData().row).toBe(old);
        store.put(2);
        expect(seen).toEqual([2]);
        stop();
    });

    test('cached Map.get finds a replaced, added, moved and deleted ordinary alias', () => {
        const original = {n: 1};
        const next = {n: 2};
        const rows = [original];
        const store = new NativeAliasStore({
            row: original, other: {n: 0}, rows, map: new Map([['row', original]]),
            set: new Set(),
        } as IState & {rows: typeof rows});
        const paths = new Set<string>();
        const view = store.read(path => paths.add(path));
        const get = view.map.get;
        expect(get.call(view.map, 'row')).toBe(original);
        expect(paths.has('rows.0')).toBe(true);

        store.change(draft => {
            const liveRows = (draft as IState & {rows: typeof rows}).rows;
            liveRows[0] = next;
            draft.row = next;
            draft.map.set('row', next);
            paths.clear();
            expect(get.call(view.map, 'row')).toBe(next);
            expect(paths.has('rows.0')).toBe(true);
            expect(paths.has('row')).toBe(true);

            liveRows.push(original);
            draft.map.set('old', original);
            paths.clear();
            expect(get.call(view.map, 'old')).toBe(original);
            expect(paths.has('rows.1')).toBe(true);
            expect(paths.has('rows.0')).toBe(false);

            liveRows.reverse();
            paths.clear();
            expect(get.call(view.map, 'old')).toBe(original);
            expect(paths.has('rows.0')).toBe(true);
            expect(paths.has('rows.1')).toBe(false);
            paths.clear();
            expect(get.call(view.map, 'row')).toBe(next);
            expect(paths.has('rows.1')).toBe(true);
            liveRows.reverse();

            liveRows.splice(1, 1);
            paths.clear();
            expect(get.call(view.map, 'old')).toBe(original);
            expect(paths.has('rows.1')).toBe(false);
            expect(paths.has('row')).toBe(false);
        });

        const changes: number[] = [];
        const stop = store.watch(data => (data.map.get('row') as typeof next).n,
            n => { changes.push(n); });
        store.putOther(9);
        expect(changes).toEqual([]);
        store.put(3);
        expect(changes).toEqual([3]);
        stop();
    });

    test('native nested member and new native entry follow same-draft topology', () => {
        const first = {n: 1};
        const second = {n: 2};
        const store = new NativeAliasStore({
            row: first, other: {n: 0},
            map: new Map([['nested', {child: first}]]), set: new Set(),
        });
        const paths = new Set<string>();
        const view = store.read(path => paths.add(path));
        expect((view.map.get('nested') as {child: typeof first}).child).toBe(first);
        store.change(draft => {
            draft.row = second;
            draft.map.set('nested', {child: second});
            draft.map.set('new', {child: second});
            paths.clear();
            expect((view.map.get('nested') as {child: typeof second}).child).toBe(second);
            expect((view.map.get('new') as {child: typeof second}).child).toBe(second);
            expect(paths.has('row')).toBe(true);
            draft.row = first;
            paths.clear();
            expect((view.map.get('new') as {child: typeof second}).child).toBe(second);
            expect(paths.has('row')).toBe(false);
        });
    });

    test('setData, restore and raw emit discard stale ordinary ownership', () => {
        const first = {n: 1};
        const store = new NativeAliasStore({
            row: first, other: {n: 0}, map: new Map([['row', first]]), set: new Set(),
        });
        const capture = (): Set<string> => {
            const paths = new Set<string>();
            store.read(path => paths.add(path)).map.get('row');
            return paths;
        };
        expect(capture().has('row')).toBe(true);
        const second = {n: 2};
        const replacement = {
            row: first, other: second, map: new Map([['row', second]]), set: new Set<{n: number}>(),
        };
        store.setData(replacement);
        expect(capture().has('other')).toBe(true);
        expect(capture().has('row')).toBe(false);
        const third = {n: 3};
        replacement.map.set('row', third);
        replacement.other = third;
        store.publishRaw();
        expect(capture().has('other')).toBe(true);
        store.restore({
            row: first, other: {n: 0}, map: new Map([['row', first]]), set: new Set(),
        });
        expect(capture().has('row')).toBe(true);
        expect(capture().has('other')).toBe(false);
    });
});
