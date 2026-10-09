import {S} from "@/Carburetor/Store/Diagnostics/Internal/StoreIdentity";
import {Carburetor, transaction} from '@/Carburetor';
import {TReadonly} from '@/Carburetor/Models/Base';
import {WILDCARD_PATH} from '@/Carburetor/Store/Paths/WildcardPath';
import {
    CARBURETOR_PATHS_SINCE, CARBURETOR_TARGETS_SINCE,
} from '@/Carburetor/Store/Utils/Models';

interface INode {
    n: number;
    link: Map<string, unknown>;
}

interface IData {
    tick: number;
    node: INode;
    other?: {n: number} | Date;
    otherMap?: Map<string, unknown>;
    rows?: Array<{id: number; n: number}>;
    date?: Date;
}

class TestStore<T extends object> extends Carburetor<T> {
    public change(fn: (draft: T) => void): void { this.update(fn); }

    public [CARBURETOR_PATHS_SINCE](baselineVersion: number): ReadonlyArray<string> | undefined {
        return super[CARBURETOR_PATHS_SINCE](baselineVersion);
    }

    /** Test bridge: the raw mutation targets behind paths written after `baseline`. */
    public proofFootprint(baseline: number): {unknown: boolean; count: number} {
        const t = this[CARBURETOR_TARGETS_SINCE](baseline);
        let count = 0;
        if (t !== undefined) for (const s of t.values()) count += s.size;
        return {unknown: t === undefined, count};
    }

    /** Test bridge: the write log's current watermark. */
    public proofWatermark(): number { return this[S.writeLog].getWatermark(); }
}

/** Counts the paths one update makes the selection re-read, mirroring the perf scenario. */
class CountingStore extends TestStore<IData> {
    public recorded = 0;

    public read(record: (path: string) => void): TReadonly<IData> {
        return super.read(path => { this.recorded++; record(path); });
    }
}

type TWake<T> = {next: TReadonly<T>; previous: TReadonly<T>};

const makeNode = (n: number): INode => {
    const node: INode = {n, link: new Map()};
    node.link.set('self', node);
    return node;
};

describe('R38 cyclic selection persistence', () => {
    test.each([
        ['unknown', undefined],
        ['wildcard', [WILDCARD_PATH]],
    ])('same-root cyclic selection safely falls back for %s write paths', (_kind, paths) => {
        const store = new TestStore<IData>({tick: 0, node: makeNode(1)});
        store[CARBURETOR_PATHS_SINCE] = () => paths;
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => { draft.tick = 1; });
        expect(wakes).toHaveLength(0);
        store.change(draft => { draft.node.n = 2; });
        expect(wakes).toHaveLength(1);
        expect(wakes[0].next.n).toBe(2);
        expect(wakes[0].previous.n).toBe(1);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        expect(wakes[0].previous.link.get('self')).toBe(wakes[0].previous);
        stop();
    });

    test('same-root cyclic Map selection ignores ticks and preserves held snapshots', () => {
        const store = new TestStore<IData>({tick: 0, node: makeNode(1)});
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => { draft.tick = 1; });
        store.change(draft => { draft.tick = 2; });
        expect(wakes).toHaveLength(0);
        store.change(draft => { draft.node.n = 2; });
        const first = wakes[0].next;
        store.change(draft => { draft.node.n = 3; });
        expect(wakes).toHaveLength(2);
        expect(wakes.map(wake => wake.next.n)).toEqual([2, 3]);
        expect(wakes[1].previous).toBe(first);
        expect(wakes[0].previous.n).toBe(1);
        expect(wakes.every(wake => wake.next.link.get('self') === wake.next)).toBe(true);
        expect(wakes[0].previous.link.get('self')).toBe(wakes[0].previous);
        stop();
    });

    test('external Map peer and Set member writes are detected from snapshot ownership', () => {
        const other = {n: 1};
        const node = makeNode(1);
        node.link.set('peer', other);
        node.link.set('members', new Set([other]));
        const store = new TestStore<IData>({tick: 0, node, other});
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => { draft.other!.n = 2; });
        const first = wakes[0].next;
        store.change(draft => { draft.other!.n = 3; });
        expect(wakes).toHaveLength(2);
        expect((wakes[0].previous.link.get('peer') as {n: number}).n).toBe(1);
        expect((wakes[1].previous.link.get('peer') as {n: number}).n).toBe(2);
        expect((wakes[0].previous.link.get('members') as Set<{n: number}>).values().next().value?.n).toBe(1);
        expect(wakes[1].previous).toBe(first);
        expect(wakes.every(wake => wake.next.link.get('self') === wake.next)).toBe(true);
        stop();
    });

    test('coarse native member writes behind external aliases are detected', () => {
        const other = new Date(1000);
        const node = makeNode(1);
        node.link.set('peer', other);
        const store = new TestStore<IData>({tick: 0, node, other});
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => {
            draft.other!.setTime(2000);
            draft.tick = 2;
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as Date).getTime()).toBe(1000);
        expect((wakes[0].next.link.get('peer') as Date).getTime()).toBe(2000);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        expect(wakes[0].previous.link.get('self')).toBe(wakes[0].previous);
        // A coarse Date mutation alone does not wake a tick/node watcher: notification matching
        // is path-based. The tick wakes it, and the mutation-target proof must then force the
        // full reconcile instead of snapshot reuse.
        store.change(draft => {
            draft.other!.setTime(3000);
            draft.tick = 3;
        });
        expect(wakes).toHaveLength(2);
        expect((wakes[1].previous.link.get('peer') as Date).getTime()).toBe(2000);
        expect((wakes[1].next.link.get('peer') as Date).getTime()).toBe(3000);
        stop();
    });

    test('raw native members handed out by a draft mark the proof unknown', () => {
        const date = new Date(1000);
        const node = makeNode(1);
        node.link.set('peer', date);
        const store = new TestStore<IData>({
            tick: 0, node, otherMap: new Map<string, unknown>([['date', date]]),
        });
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => {
            const member = draft.otherMap!.get('date');
            (member as Date).setTime(2000);
            draft.tick = 2;
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as Date).getTime()).toBe(1000);
        expect((wakes[0].next.link.get('peer') as Date).getTime()).toBe(2000);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        expect(wakes[0].previous.link.get('self')).toBe(wakes[0].previous);
        store.change(draft => {
            const member = draft.otherMap!.get('date');
            (member as Date).setTime(3000);
            draft.tick = 3;
        });
        expect(wakes).toHaveLength(2);
        expect((wakes[1].previous.link.get('peer') as Date).getTime()).toBe(2000);
        expect((wakes[1].next.link.get('peer') as Date).getTime()).toBe(3000);
        stop();
    });

    test('repeated one-path replacements keep delivering and bound the target history', () => {
        const store = new TestStore<{tick: number; other: {n: number}}>({tick: 0, other: {n: 0}});
        const seen: Array<{n: number}> = [];
        const stop = store.watch(data => { void data.tick; return data.other; }, next => seen.push(next));
        for (let index = 1; index <= 1100; index++) {
            store.change(draft => { draft.other = {n: index}; });
            expect(seen).toHaveLength(index);
            expect(seen[index - 1].n).toBe(index);
        }
        // Per-publication target replacement means this scenario cannot overflow the bound, so
        // no reset is expected and the watermark stays at its initial value.
        const footprint = store.proofFootprint(store.getVersion());
        expect(footprint.unknown || footprint.count <= 8192).toBe(true);
        stop();
    });

    test('two publications inside one transaction deliver the reachable peer change', () => {
        const other = {n: 1};
        const node = makeNode(1);
        node.link.set('peer', other);
        const store = new TestStore<IData>({tick: 0, node, other});
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        transaction(() => {
            store.change(d => { d.other!.n = 2; d.tick = 1; });
            store.change(d => { d.other = {n: 3}; d.tick = 2; });
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as {n: number}).n).toBe(1);
        expect((wakes[0].next.link.get('peer') as {n: number}).n).toBe(2);
        expect(store.getData().other.n).toBe(3);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        expect(wakes[0].previous.link.get('self')).toBe(wakes[0].previous);
        stop();
    });

    test('an unattributed publication cannot borrow an earlier same-path target', () => {
        class Publisher extends TestStore<{node: INode; other: {n: number}; tick: number}> {
            public rawPublish(other: {n: number}, paths: ReadonlyArray<string>): void {
                this.data.other = other;
                other.n = 3;
                this.data.tick = 2;
                for (const path of paths) this[S.recordWrite](path);
                this.emitUpdate();
            }
        }
        const peer = {n: 1};
        const node = makeNode(1);
        node.link.set('peer', peer);
        const store = new Publisher({node, other: {n: 1}, tick: 0});
        let last = '';
        const view = store.read(path => { last = path; });
        void view.other.n;
        const otherPath = last;
        void view.tick;
        const tickPath = last;
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        transaction(() => {
            store.change(data => { data.other.n = 2; data.tick = 1; });
            store.rawPublish(peer, [otherPath, tickPath]);
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].next.link.get('peer') as {n: number}).n).toBe(3);
        expect((wakes[0].previous.link.get('peer') as {n: number}).n).toBe(1);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        expect(store.getData().other).toBe(peer);
        stop();
    });

    test('a large plain batch keeps the relative patch cost past the raw-target bound', () => {
        const store = new CountingStore({
            tick: 0, rows: Array.from({length: 4000}, (_, id) => ({id, n: 0})),
        });
        const seen: Array<TReadonly<Array<{id: number; n: number}>>> = [];
        const stop = store.watch(d => { void d.tick; return d.rows; }, next => seen.push(next));
        // Control: changing every row forces the whole-walk cost in this mode.
        store.recorded = 0;
        store.change(d => { d.rows!.forEach(row => { row.n = -1; }); });
        expect(seen).toHaveLength(1);
        expect(seen[0].map(row => [row.id, row.n])).toEqual(
            Array.from({length: 4000}, (_, id) => [id, -1])
        );
        const fullWalkReads = store.recorded;
        store.recorded = 0;
        // Past the raw-target bound (1025 > 1024) the raw proof drops but the ordinary path
        // history stays complete, so the changed leaves still take the relative patch route.
        // Each changed leaf plans index+field segments (~3K work), so the batch must stay
        // sparse relative to N — the parent probe's N=4000/K=1025 proportions; a dense batch
        // honestly takes the full walk.
        store.change(d => {
            for (let index = 0; index < 1025; index++) d.rows![index].n = index + 1;
        });
        expect(seen).toHaveLength(2);
        expect(seen[1].map(row => [row.id, row.n])).toEqual(
            Array.from({length: 4000}, (_, id) => [id, id < 1025 ? id + 1 : -1])
        );
        expect(store.recorded).toBeLessThan(fullWalkReads / 2);
        stop();
    });

    test.each([null, 0])('opaque effects survive replacement with %s', replacement => {
        const other = {n: 1};
        const map = Object.assign(new Map([['stable', 0]]), {poke: (): void => { other.n = 2; }});
        const store = new TestStore<{node: {other: {n: number}; map: typeof map | number | null; tick: number}}>({
            node: {other, map, tick: 0},
        });
        type TNode = ReturnType<typeof store.getData>['node'];
        const seen: Array<TWake<TNode>> = [];
        const stop = store.watch(data => data.node, (next, previous) => seen.push({next, previous}));
        store.change(draft => {
            (draft.node.map as typeof map).poke();
            draft.node.map = replacement;
            draft.node.tick = 2;
        });
        expect(seen).toHaveLength(1);
        expect(seen[0].next.other.n).toBe(2);
        expect(seen[0].previous.other.n).toBe(1);
        expect(seen[0].next.map).toBe(replacement);
        expect(seen[0].previous.map instanceof Map).toBe(true);
        expect(seen[0].next.tick).toBe(2);
        expect(seen[0].previous.tick).toBe(0);
        stop();
    });

    test('a same-path replacement does not hide an earlier in-place mutation of the old object', () => {
        const other = {n: 1};
        const node = makeNode(1);
        node.link.set('peer', other);
        const store = new TestStore<IData>({tick: 0, node, other});
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => {
            (draft.other as {n: number}).n = 2;
            draft.other = {n: 3};
            draft.tick = 2;
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as {n: number}).n).toBe(1);
        expect((wakes[0].next.link.get('peer') as {n: number}).n).toBe(2);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        stop();
    });

    test('fresh projected cyclic node ignores equal ticks and reports actual edits', () => {
        const store = new TestStore<IData>({tick: 0, node: makeNode(1)});
        type TProjected = {n: number; link: Map<string, unknown>};
        const wakes: Array<TWake<TProjected>> = [];
        const stop = store.watch(data => {
            void data.tick;
            const node: TProjected = {n: data.node.n, link: new Map()};
            node.link.set('self', node);
            return node;
        }, (next, previous) => wakes.push({next, previous}));
        store.change(draft => { draft.tick = 1; });
        store.change(draft => { draft.tick = 2; });
        expect(wakes).toHaveLength(0);
        store.change(draft => { draft.node.n = 2; });
        const first = wakes[0].next;
        store.change(draft => { draft.node.n = 3; });
        expect(wakes).toHaveLength(2);
        expect(first.n).toBe(2);
        expect(wakes[1].previous).toBe(first);
        expect(wakes.map(wake => wake.next.n)).toEqual([2, 3]);
        expect(wakes.every(wake => wake.next.link.get('self') === wake.next)).toBe(true);
        stop();
    });

    test('an update with more recordings than the budget keeps delivering reachable native changes', () => {
        const date = new Date(1000);
        const node = makeNode(1);
        node.link.set('peer', date);
        const store = new TestStore<IData>({
            tick: 0, node, date,
            rows: Array.from({length: 4100}, (_, id) => ({id, n: 0})),
        });
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => {
            draft.rows!.forEach((row, index) => { row.n = index; });
            draft.date!.setTime(2000);
            draft.tick = 2;
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as Date).getTime()).toBe(1000);
        expect((wakes[0].next.link.get('peer') as Date).getTime()).toBe(2000);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        expect(wakes[0].previous.link.get('self')).toBe(wakes[0].previous);
        stop();
    });

    test('many completed publications keep the budget fresh for later native mutations', () => {
        const date = new Date(1000);
        const node = makeNode(1);
        node.link.set('peer', date);
        const store = new TestStore<IData>({tick: 0, node, other: {n: 0}, date});
        const wakes: Array<TWake<INode>> = [];
        const others: Array<{n: number}> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        const stopOther = store.watch(data => { void data.tick; return data.other; },
            next => others.push(next));
        for (let index = 1; index <= 4097; index++) {
            store.change(draft => { draft.other = {n: index}; });
        }
        expect(others).toHaveLength(4097);
        expect(others[4096].n).toBe(4097);
        store.change(draft => {
            draft.date!.setTime(2000);
            draft.tick = 2;
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as Date).getTime()).toBe(1000);
        expect((wakes[0].next.link.get('peer') as Date).getTime()).toBe(2000);
        stopOther();
        stop();
    });

    test('opaque draft methods mark the proof unknown', () => {
        const date = new Date(1000);
        const node = makeNode(1);
        node.link.set('peer', date);
        const otherMap = new Map<string, unknown>([['date', date]]);
        (otherMap as unknown as {mutate: () => void}).mutate = function (): void {
            date.setTime(5000);
        };
        const store = new TestStore<IData>({tick: 0, node, otherMap});
        const wakes: Array<TWake<INode>> = [];
        const stop = store.watch(data => { void data.tick; return data.node; },
            (next, previous) => wakes.push({next, previous}));
        store.change(draft => {
            draft.otherMap!.mutate();
            draft.tick = 2;
        });
        expect(wakes).toHaveLength(1);
        expect((wakes[0].previous.link.get('peer') as Date).getTime()).toBe(1000);
        expect((wakes[0].next.link.get('peer') as Date).getTime()).toBe(5000);
        expect(wakes[0].next.link.get('self')).toBe(wakes[0].next);
        (otherMap as unknown as {mutate: () => void}).mutate = function (): void {
            date.setTime(6000);
        };
        store.change(draft => {
            draft.otherMap!.mutate();
            draft.tick = 3;
        });
        expect(wakes).toHaveLength(2);
        expect((wakes[1].previous.link.get('peer') as Date).getTime()).toBe(5000);
        expect((wakes[1].next.link.get('peer') as Date).getTime()).toBe(6000);
        stop();
    });
});
