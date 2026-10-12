import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

interface IState {
    rows: {n: number}[];
    slot: {child: {n: number} | null} | null;
    spare: number;
    native?: Map<string, number>;
}

class Store extends Carburetor<IState> {
    public edit(fn: (draft: IState) => void): void { this.update(fn); }
}

class History extends CarburetorHistory<IState> {
    public entries() { return this.past; }
    public pending() { return this.pendingPatches; }
}

class ManualThrottle extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}

const state = (): IState => ({rows: Array.from({length: 8}, () => ({n: 0})), slot: null, spare: 0});
const numbers = (store: Store): number[] => store.getData().rows.map(row => row.n);

describe('R43-S02 publication-local owned fold eligibility', () => {
    test.each(['update', 'transaction', 'throttle', 'separate'])('%s keeps exact scalar boundaries', mode => {
        const throttle = mode === 'throttle' ? new ManualThrottle() : undefined;
        const store = new Store(state(), throttle);
        const history = new History(store);
        const reads = new Set<string>();
        const spareReads = new Set<string>();
        void store.read(path => reads.add(path)).rows[0].n;
        void store.read(path => spareReads.add(path)).spare;
        let all = 0, precise = 0, spare = 0;
        const ids = [store.subscribe(() => all++), store.subscribe(() => precise++, {reads}),
            store.subscribe(() => spare++, {reads: spareReads})];
        try {
            const edits = (): void => {
                for (let i = 0; i < 8; i++) store.edit(d => { d.rows[i].n = 1; });
            };
            if (mode === 'update') store.edit(d => { for (const row of d.rows) row.n = 1; });
            else if (mode === 'transaction') transaction(edits);
            else edits();
            if (throttle) {
                expect(history.canUndo()).toBe(false);
                throttle.flush();
            }
            const steps = mode === 'separate' ? 8 : 1;
            expect(all).toBe(steps);
            expect(precise).toBe(1);
            expect(spare).toBe(0);
            expect(history.entries()).toHaveLength(steps);
            const entry = history.entries().at(-1);
            expect(entry?.kind).toBe('patches');
            if (entry?.kind === 'patches') expect(entry.patches).toHaveLength(mode === 'separate' ? 1 : 8);
            for (let i = 0; i < steps; i++) {
                expect(history.undo()).toBe(true);
                throttle?.flush();
                expect(numbers(store)).toEqual(mode === 'separate'
                    ? Array.from({length: 8}, (_, index) => index < 7 - i ? 1 : 0) : Array(8).fill(0));
            }
            expect(history.undo()).toBe(false);
            store.edit(d => { d.rows[0].n = 2; d.rows[0].n = 0; });
            throttle?.flush();
            expect(history.canUndo()).toBe(false);
            expect(history.canRedo()).toBe(true);
            for (let i = 0; i < steps; i++) {
                expect(history.redo()).toBe(true);
                throttle?.flush();
                expect(numbers(store)).toEqual(mode === 'separate'
                    ? Array.from({length: 8}, (_, index) => index <= i ? 1 : 0) : Array(8).fill(1));
            }
            expect(history.redo()).toBe(false);
            expect(spare).toBe(0);
        } finally { ids.forEach(id => store.unsubscribe(id)); history.disconnect(); }
    });

    test('owned insertion, replacement barriers and retained endpoints remain isolated', () => {
        const store = new Store(state());
        const history = new History(store);
        try {
            store.edit(d => {
                d.rows[0].n = 1;
                d.slot = {child: {n: 1}};
                d.slot.child!.n = 2;
                d.rows[1].n = 3;
            });
            const entry = history.entries()[0];
            expect(entry.kind).toBe('patches');
            if (entry.kind !== 'patches') throw new Error('expected owned patches');
            expect(entry.patches).toHaveLength(3);
            const endpoint = entry.patches[1].next;
            expect(endpoint).toEqual({child: {n: 2}});
            expect(endpoint).not.toBe(store.getData().slot);
            store.edit(d => {
                d.slot = {child: {n: 3}};
                d.slot.child = null;
                d.slot.child = {n: 4};
                d.slot.child.n = 5;
            });
            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toEqual({child: {n: 2}});
            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toBe(null);
            expect(numbers(store)).toEqual(Array(8).fill(0));
            expect(history.redo()).toBe(true);
            expect(history.redo()).toBe(true);
            expect(store.getData().slot).toEqual({child: {n: 5}});
            expect(endpoint).toEqual({child: {n: 2}});
        } finally { history.disconnect(); }
    });

    test('clear resets a deferred owned batch without clearing an independent history', () => {
        const throttle = new ManualThrottle();
        const store = new Store(state(), throttle);
        const first = new History(store), second = new History(store);
        try {
            store.edit(d => { d.slot = {child: {n: 1}}; d.slot.child!.n = 2; });
            first.clear();
            store.edit(d => { d.rows[0].n = 3; d.rows[1].n = 4; });
            expect(first.pending()).toHaveLength(2);
            throttle.flush();
            expect(first.undo()).toBe(true);
            throttle.flush();
            expect(numbers(store)).toEqual(Array(8).fill(0));
            expect(store.getData().slot).toEqual({child: {n: 2}});
            expect(first.undo()).toBe(false);
            expect(first.redo()).toBe(true);
            throttle.flush();
            expect(second.undo()).toBe(true);
            throttle.flush();
            expect(numbers(store)).toEqual(Array(8).fill(0));
            expect(store.getData().slot).toEqual({child: {n: 2}});
        } finally { first.disconnect(); second.disconnect(); }
    });

    test('transaction publication and replay reentry start fresh scalar and owned batches', () => {
        const store = new Store(state());
        const history = new History(store);
        let phase = 0;
        const id = store.subscribe(() => {
            if (phase === 0 && store.getData().slot !== null) {
                phase = 1;
                store.edit(d => { d.rows[0].n = 7; d.rows[1].n = 8; });
            } else if (phase === 2 && store.getData().rows[0].n === 0) {
                phase = 3;
                store.edit(d => { d.slot = {child: {n: 9}}; d.slot.child!.n = 10; });
            }
        });
        try {
            transaction(() => {
                store.edit(d => { d.slot = {child: {n: 1}}; });
                store.edit(d => { d.slot!.child!.n = 2; });
            });
            expect(history.entries()).toHaveLength(2);
            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toEqual({child: {n: 2}});
            expect(history.redo()).toBe(true);
            phase = 2;
            expect(history.undo()).toBe(true);
            expect(phase).toBe(3);
            expect(history.canRedo()).toBe(false);
            expect(store.getData().slot).toEqual({child: {n: 10}});
            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toEqual({child: {n: 2}});
            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toBe(null);
        } finally { store.unsubscribe(id); history.disconnect(); }
    });

    test.each(['native', 'restricted', 'sparse'])('%s fallback survives scalar writes and replay', kind => {
        const initial = state();
        if (kind === 'sparse') {
            initial.rows = Array(8);
            initial.rows[3] = {n: 0};
        }
        if (kind === 'restricted') Object.defineProperty(initial, 'spare', {
            value: 0, writable: false, enumerable: true, configurable: false,
        });
        if (kind === 'native') initial.native = new Map([['n', 1]]);
        const store = new Store(initial);
        const history = new History(store);
        try {
            const index = kind === 'sparse' ? 3 : 0;
            store.edit(d => { d.slot = {child: {n: 1}}; d.slot.child!.n = 2; d.rows[index].n = 4; });
            expect(history.undo()).toBe(true);
            expect(store.getData().slot).toBe(null);
            expect(store.getData().rows[index].n).toBe(0);
            expect(history.redo()).toBe(true);
            expect(store.getData().slot).toEqual({child: {n: 2}});
            expect(store.getData().rows[index].n).toBe(4);
            if (kind === 'native') expect(store.getData().native?.get('n')).toBe(1);
            if (kind === 'sparse') expect(Object.hasOwn(store.getData().rows, 0)).toBe(false);
            if (kind === 'restricted') {
                expect(Object.getOwnPropertyDescriptor(store.getData(), 'spare')?.writable).toBe(false);
            }
        } finally { history.disconnect(); }
    });
});
