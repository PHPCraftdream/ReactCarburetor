import {Carburetor, CarburetorHistory} from '@/Carburetor';

interface IGraph {
    stamp: Date | null;
    row: {n: number};
    map: Map<object, object>;
    items: number[];
}
class GraphStore extends Carburetor<IGraph> {
    public edit(): void {
        this.update(d => {
            d.stamp = new Date(1000);
            d.row.n = 2;
            Object.defineProperty(d.items, 'length', {value: 1, writable: false});
        });
    }
}

test('history44 authoritative graph retains native aliases, root cycles and descriptor capabilities', () => {
    const row = {n: 1};
    // Restricted plain data remains enumerable; non-enumerable metadata belongs to a native.
    Object.defineProperty(row, 'fixed', {value: 7, enumerable: true, writable: false, configurable: false});
    const root: IGraph = {stamp: null, row, map: new Map([[row, row]]), items: [1, 2]};
    Object.defineProperty(root.map, 'hidden', {
        value: 7, enumerable: false, writable: false, configurable: true,
    });
    Object.defineProperty(root.map, 'owner', {value: root, configurable: true});
    const store = new GraphStore(root);
    const history = new CarburetorHistory(store);
    const check = (current: IGraph, n: number, length: number, writable: boolean): void => {
        expect(current.row.n).toBe(n);
        expect(current.map.get(current.row)).toBe(current.row);
        expect(Object.getOwnPropertyDescriptor(current.map, 'owner')).toMatchObject({
            value: current, enumerable: false, writable: false, configurable: true,
        });
        expect(Object.getOwnPropertyDescriptor(current.map, 'hidden')).toMatchObject({
            value: 7, enumerable: false, writable: false, configurable: true,
        });
        expect(Object.getOwnPropertyDescriptor(current.row, 'fixed')).toMatchObject({
            value: 7, enumerable: true, writable: false, configurable: false,
        });
        expect(current.items).toEqual(length === 1 ? [1] : [1, 2]);
        expect(Object.getOwnPropertyDescriptor(current.items, 'length')).toMatchObject({
            value: length, writable,
        });
    };
    try {
        store.edit();
        for (let i = 0; i < 2; i++) {
            expect(history.undo()).toBe(true);
            check(store.getData(), 1, 2, true);
            expect(store.getData().stamp).toBeNull();
            expect(history.redo()).toBe(true);
            check(store.getData(), 2, 1, false);
            expect(store.getData().stamp?.getTime()).toBe(1000);
        }
    } finally { history.disconnect(); }
});

test('history44 authoritative capture rejects an accessor without invoking it after opacity', () => {
    let getters = 0;
    // Native accessor metadata is supported by operational state ownership, but not history.
    // Unlike a plain getter insertion, this reaches capture without producer validation reading it.
    const unsafe = Object.defineProperty(new Date(1000), 'value', {
        get: () => { getters++; return 1; }, enumerable: false,
    });
    type State = {stamp: Date | null; slot: object | null};
    class CapturedStore extends Carburetor<State> {
        public captures = 0;
        public captureHistory(own: <V>(value: V) => V): State {
            this.captures++;
            return super.captureHistory(own);
        }
    }
    class InspectedHistory extends CarburetorHistory<State> {
        public owned(): State { return this.baseline; }
    }
    const store = new CapturedStore({stamp: null, slot: null});
    const history = new InspectedHistory(store);
    const baseline = history.owned();
    const captures = store.captures;
    const originalError = console.error;
    const reported: string[] = [];
    const observed: Array<Date | null> = [];
    const subscription = store.subscribe(() => { observed.push(store.getData().stamp); });
    console.error = (...args: unknown[]) => { reported.push(args.map(String).join(' ')); };
    try {
        // Capture rejects the endpoint, but delivery isolates that failure after installation.
        expect(() => store.update(d => { d.stamp = unsafe; })).not.toThrow();
        expect(reported).toHaveLength(1);
        expect(reported[0]).toMatch(/accessor/i);
        expect(reported[0]).toMatch(/cannot snapshot/i);
        expect(reported[0]).toMatch(/write.*landed/i);
        expect(observed).toHaveLength(1);
        expect(observed[0]).toBe(unsafe);
        expect(store.captures).toBe(captures + 1);
        expect(store.getData().stamp).toBe(unsafe); // Installation precedes history publication.
        expect(getters).toBe(0);
        expect(history.owned()).toBe(baseline);
        expect(baseline).toEqual({stamp: null, slot: null});
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        // A supported replacement retries the pending capture from the unadvanced baseline.
        store.update(d => { d.stamp = new Date(2000); });
        expect(history.undo()).toBe(true);
        expect(store.getData().stamp).toBeNull();
        expect(history.redo()).toBe(true);
        expect(store.getData().stamp?.getTime()).toBe(2000);
        expect(getters).toBe(0);
        expect(reported).toHaveLength(1); // Recovery and replay produce no further diagnostics.
    } finally {
        console.error = originalError;
        store.unsubscribe(subscription);
        history.disconnect();
    }
});
