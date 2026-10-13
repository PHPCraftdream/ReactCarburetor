import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

interface IState {
    stamp: Date | null;
    slot: {child: {n: number}} | null;
    items: number[];
    row: {first?: number; last: number};
    keep: number;
}
class Store extends Carburetor<IState> {
    public run(fn: (draft: IState) => void): void { this.update(fn); }
    public reject = false;
    public override restore(state: IState): void {
        if (this.reject) throw new Error('restore refused');
        super.restore(state);
    }
}
class Manual extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}
const initial = (): IState => ({stamp: null, slot: null, items: [1, 2], row: {first: 1, last: 2}, keep: 7});

describe('history44 opaque ownership boundaries', () => {
    test.each(['update', 'transaction', 'manual'] as const)('authoritative endpoints in %s', mode => {
        const throttle = mode === 'manual' ? new Manual() : undefined;
        const store = new Store(initial(), throttle);
        const history = new CarburetorHistory(store);
        const source = {child: {n: 1}};
        let wakes = 0, spare = 0, patches = 0;
        const id = store.subscribe(() => wakes++);
        const stop = store.watch(d => d.keep, () => spare++);
        const dispose = store.attachPatchListener({patch: patch => {
            if (typeof patch !== 'symbol') patches++;
        }});
        try {
            const edit = (): void => store.run(d => {
                d.slot = {child: {n: 0}};
                d.stamp = new Date(1000);
                d.slot = source;
                d.slot.child.n = 2;
                d.slot = null;
                d.slot = {child: {n: 3}};
            });
            if (mode === 'transaction') transaction(edit); else edit();
            throttle?.flush();
            expect(patches).toBeGreaterThanOrEqual(6);
            source.child.n = 99;
            store.reject = true;
            expect(() => history.undo()).toThrow('restore refused');
            expect(history.canUndo()).toBe(true);
            expect(history.canRedo()).toBe(false);
            store.reject = false;
            for (let i = 0; i < 2; i++) {
                expect(history.undo()).toBe(true);
                throttle?.flush();
                expect(store.getData().slot).toBe(null);
                expect(store.getData().stamp).toBe(null);
                expect(history.redo()).toBe(true);
                throttle?.flush();
                expect(store.getData().slot?.child.n).toBe(3);
                expect(store.getData().stamp?.getTime()).toBe(1000);
            }
            expect(wakes).toBe(5);
            expect(spare).toBe(0);
        } finally { dispose(); stop(); store.unsubscribe(id); history.disconnect(); }
    });

    test.each(['lock', 'order'] as const)('later %s survives an opaque native transition canceled to plain', marker => {
        const store = new Store(initial());
        const history = new CarburetorHistory(store);
        try {
            store.run(d => {
                d.stamp = new Date(1000);
                d.stamp = null;
                if (marker === 'lock') Object.defineProperty(d.items, 'length', {value: 1, writable: false});
                else { delete d.row.first; d.row.first = 1; }
            });
            for (let i = 0; i < 2; i++) {
                expect(history.undo()).toBe(true);
                expect(Object.keys(store.getData().row)).toEqual(['first', 'last']);
                expect(store.getData().items).toEqual([1, 2]);
                expect(Object.getOwnPropertyDescriptor(store.getData().items, 'length')?.writable).toBe(true);
                expect(history.redo()).toBe(true);
                if (marker === 'lock') {
                    expect(store.getData().items).toEqual([1]);
                    expect(Object.getOwnPropertyDescriptor(store.getData().items, 'length')?.writable).toBe(false);
                } else expect(Object.keys(store.getData().row)).toEqual(['last', 'first']);
            }
        } finally { history.disconnect(); }
    });

    test('clear before flush splits only its own history baseline', () => {
        const throttle = new Manual();
        const store = new Store(initial(), throttle);
        const first = new CarburetorHistory(store), second = new CarburetorHistory(store);
        try {
            store.run(d => { d.stamp = new Date(1000); d.slot = {child: {n: 1}}; });
            first.clear();
            store.run(d => { d.slot = {child: {n: 2}}; });
            throttle.flush();
            expect(first.undo()).toBe(true);
            throttle.flush();
            expect(store.getData().slot?.child.n).toBe(1);
            expect(store.getData().stamp?.getTime()).toBe(1000);
            expect(first.undo()).toBe(false);
            first.disconnect();
            expect(second.undo()).toBe(true);
            throttle.flush();
            expect(store.getData().slot?.child.n).toBe(2);
            expect(second.undo()).toBe(true);
            throttle.flush();
            expect(store.getData().slot).toBe(null);
            expect(store.getData().stamp).toBe(null);
        } finally { first.disconnect(); second.disconnect(); }
    });
});
