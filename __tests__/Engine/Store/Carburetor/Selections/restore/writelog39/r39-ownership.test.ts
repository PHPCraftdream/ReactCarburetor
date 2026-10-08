import {Carburetor} from '@/Carburetor';

interface INode {n: number; link: Map<string, unknown>}
interface IData {tick: number; node: INode; peer: {n: number}; date: Date; rows: Array<{n: number}>}
class Store extends Carburetor<IData> {
    public recorded = 0;
    public change(fn: (draft: IData) => void): void { this.update(fn); }
    public bypass(): void { this.data.node.n++; this.markAllChanged(); this.emitUpdate(); }
    public override read(record: (path: string) => void): ReturnType<Carburetor<IData>['read']> {
        return super.read(path => { this.recorded++; record(path); });
    }
}
const makeStore = (): Store => {
    const peer = {n: 1};
    const date = new Date(1000);
    const node: INode = {n: 1, link: new Map()};
    node.link.set('self', node);
    node.link.set('peer', peer);
    node.link.set('date', date);
    node.link.set('members', new Set([peer]));
    return new Store({tick: 0, node, peer, date, rows: Array.from({length: 2000}, () => ({n: 0}))});
};

describe('public ownership safety controls (R39-01)', () => {
    test('cyclic and coarse Date snapshots safety control with explicit tick dependency', () => {
        const store = makeStore();
        const seen: INode[] = [];
        const before: INode[] = [];
        const stop = store.watch(d => { void d.tick; return d.node; }, (next, previous) => {
            seen.push(next); before.push(previous);
        });
        try {
            for (let k = 0; k < 2; k++) store.change(d => { d.tick++; });
            expect(seen).toHaveLength(0);
            store.change(d => { d.peer.n = 2; d.tick++; });
            store.change(d => { d.date.setTime(2000); d.tick++; });
            expect(seen).toHaveLength(2);
            for (const value of [...seen, ...before]) {
                expect(value.link.get('self')).toBe(value);
                expect((value.link.get('members') as Set<unknown>).has(value.link.get('peer'))).toBe(true);
            }
            expect((before[0].link.get('peer') as {n: number}).n).toBe(1);
            expect((seen[0].link.get('peer') as {n: number}).n).toBe(2);
            expect((before[1].link.get('date') as Date).getTime()).toBe(1000);
            expect((seen[1].link.get('date') as Date).getTime()).toBe(2000);
        } finally { stop(); }
    });

    test('markAllChanged bypass reconciles the changed cycle and later writes recover', () => {
        const store = makeStore();
        const seen: INode[] = [];
        const stop = store.watch(d => d.node, next => seen.push(next));
        try {
            store.bypass();
            expect(seen[0].n).toBe(2);
            expect(seen[0].link.get('self')).toBe(seen[0]);
            for (let k = 0; k < 64; k++) store.change(d => { d.tick++; });
            store.change(d => { d.node.n = 3; });
            expect(seen).toHaveLength(2);
            expect(seen[1].n).toBe(3);
            expect(seen[0].n).toBe(2);
        } finally { stop(); }
    });

    test('per-publication overflow causes one full list walk then restores the sparse route', () => {
        const store = makeStore();
        const seen: Array<Array<{n: number}>> = [];
        const stop = store.watch(d => d.rows, next => seen.push(next));
        try {
            store.change(d => { for (let i = 1; i <= 1025; i++) d.peer = {n: i + 1}; });
            expect(seen).toHaveLength(0);
            store.change(d => { d.tick++; });
            store.recorded = 0;
            store.change(d => { d.rows[1500].n = 2; });
            expect(store.recorded).toBeGreaterThan(2000);
            expect(seen[0][1500].n).toBe(2);
            for (let k = 0; k < 64; k++) store.change(d => { d.tick++; });
            store.recorded = 0;
            store.change(d => { d.rows[1500].n = 3; });
            expect(store.recorded).toBeLessThanOrEqual(4);
            expect(seen[1][1500].n).toBe(3);
            expect(seen[0][1500].n).toBe(2);
        } finally { stop(); }
    });
});
