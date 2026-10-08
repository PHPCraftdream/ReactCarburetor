import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

interface IRow { id: number; title: string; done: boolean; }
type Native = Date | Map<string, number> | Set<number>;
interface IState { items: IRow[]; native?: Native; }

const makeState = (kind: string, size = 2000): IState => {
    const state: IState = {
        items: Array.from({length: size}, (_, id) => ({id, title: `T${id}`, done: false})),
    };
    if (kind === 'date') state.native = new Date(1700000000000);
    if (kind === 'map') state.native = new Map([['k', 1]]);
    if (kind === 'set') state.native = new Set([1]);
    return state;
};

class CountedStore extends Carburetor<IState> {
    public captures = 0;
    public ownCalls = 0;
    public captureHistory(own: <V>(value: V) => V): IState {
        this.captures++;
        return super.captureHistory(<V>(value: V): V => {
            this.ownCalls++;
            return own(value);
        });
    }
    public reset(): void { this.captures = 0; this.ownCalls = 0; }
    public title(value: string): void {
        this.update(draft => { draft.items[17].title = value; });
    }
}

class InspectedHistory<T extends object> extends CarburetorHistory<T> {
    public kinds(): string[] { return this.past.map(entry => entry.kind); }
    public owned(): T { return this.baseline; }
}

class ManualThrottle extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}

const nativeValue = (value: Native | undefined): unknown => {
    if (value instanceof Date) return value.getTime();
    if (value instanceof Map) return [...value];
    if (value instanceof Set) return [...value];
    return undefined;
};

// R39-02: admission, replay and ownership must depend on the changed path, not a sibling native.
describe('native baseline existing open scalar paths', () => {
    test.each(['date', 'map', 'set'])('%s at 2000 rows records only scalar patches', kind => {
        const store = new CountedStore(makeState(kind));
        const history = new InspectedHistory(store);
        try {
            store.title('changed');
            expect(history.kinds()).toEqual(['patches']);
        } finally { history.disconnect(); }
    });

    test.each(['date', 'map', 'set'])('%s replay wakes the exact same paths as plain replay', kind => {
        const exercise = (baseline: string): number[][] => {
            const store = new CountedStore(makeState(baseline));
            const history = new InspectedHistory(store);
            const wakes = [0, 0, 0, 0];
            const paths = ['items.17.title', 'items.18.title', 'items.17.done', 'native'];
            const subscriptions = paths.map((path, index) => store.subscribe(() => { wakes[index]++; },
                {reads: new Set([path])}));
            const trace: number[][] = [];
            try {
                store.title('changed');
                trace.push([...wakes]);
                expect(history.undo()).toBe(true);
                expect(store.getData().items[17].title).toBe('T17');
                trace.push([...wakes]);
                expect(history.redo()).toBe(true);
                expect(store.getData().items[17].title).toBe('changed');
                trace.push([...wakes]);
                return trace;
            } finally {
                subscriptions.forEach(subscription => store.unsubscribe(subscription));
                history.disconnect();
            }
        };
        const plain = exercise('plain');
        expect(plain).toEqual([[1, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0]]);
        expect(exercise(kind)).toEqual(plain);
    });

    test.each(['date', 'map', 'set'])('%s undo/redo retain untouched live and owned native identity', kind => {
        const store = new CountedStore(makeState(kind));
        const history = new InspectedHistory(store);
        const live = store.getData();
        const owned = history.owned();
        const value = nativeValue(live.native);
        try {
            store.title('changed');
            expect(history.undo()).toBe(true);
            expect(store.getData().items[17].title).toBe('T17');
            expect(store.getData().native).toBe(live.native);
            expect(history.owned().native).toBe(owned.native);
            expect(history.redo()).toBe(true);
            expect(store.getData().items[17].title).toBe('changed');
            expect(store.getData().native).toBe(live.native);
            expect(history.owned().native).toBe(owned.native);
            expect(nativeValue(store.getData().native)).toEqual(value);
        } finally { history.disconnect(); }
    });

    test.each([32, 2000, 10000])('scalar write at %s rows invokes zero full capture own calls', size => {
        const store = new CountedStore(makeState('date', size));
        const history = new InspectedHistory(store);
        try {
            expect(store.captures).toBe(1);
            expect(store.ownCalls).toBe(1);
            store.reset();
            store.title('changed');
            expect([store.captures, store.ownCalls]).toEqual([0, 0]);
            expect(history.undo()).toBe(true);
            expect(history.redo()).toBe(true);
            expect([store.captures, store.ownCalls]).toEqual([0, 0]);
            store.reset();
            store.update(draft => { draft.native = new Date(1800000000000); });
            expect(store.captures).toBeGreaterThan(0);
            expect(store.ownCalls).toBeGreaterThan(0);
            expect(history.kinds()).toEqual(['patches', 'snapshot']);
        } finally { history.disconnect(); }
    });

    test('native replacement is a positive control for full capture ownership', () => {
        const store = new CountedStore(makeState('date'));
        const history = new InspectedHistory(store);
        try {
            store.reset();
            store.update(draft => { draft.native = new Date(1800000000000); });
            expect([store.captures, store.ownCalls]).toEqual([1, 1]);
            expect(history.kinds()).toEqual(['snapshot']);
            expect(history.undo()).toBe(true);
            expect(nativeValue(store.getData().native)).toBe(1700000000000);
            expect(history.redo()).toBe(true);
            expect(nativeValue(store.getData().native)).toBe(1800000000000);
        } finally { history.disconnect(); }
    });

    test.each(['date', 'map', 'set'])('%s branching and clear keep the new scalar baseline', kind => {
        const store = new CountedStore(makeState(kind));
        const history = new InspectedHistory(store);
        try {
            store.title('first');
            store.title('second');
            expect(history.undo()).toBe(true);
            store.title('branch');
            expect(history.canRedo()).toBe(false);
            expect(history.undo()).toBe(true);
            expect(store.getData().items[17].title).toBe('first');
            expect(history.redo()).toBe(true);
            history.clear();
            expect(history.canUndo()).toBe(false);
            expect(history.canRedo()).toBe(false);
            store.title('after-clear');
            expect(history.undo()).toBe(true);
            expect(store.getData().items[17].title).toBe('branch');
            expect(history.redo()).toBe(true);
            expect(store.getData().items[17].title).toBe('after-clear');
            expect(history.kinds()).toEqual(['patches']);
        } finally { history.disconnect(); }
    });

    test.each(['transaction', 'coalesced', 'throttle'])(
        '%s keeps one scalar patch entry and replay ownership', mode => {
        const throttle = mode === 'throttle' ? new ManualThrottle() : undefined;
        const store = new CountedStore(makeState('date'), throttle);
        const history = new InspectedHistory(store);
        const native = store.getData().native;
        const flush = (): void => { throttle?.flush(); };
        try {
            store.reset();
            if (mode === 'coalesced') {
                store.update(draft => {
                    draft.items[17].title = 'intermediate';
                    draft.items[17].title = 'final';
                    draft.items[18].done = true;
                });
            } else {
                const write = (): void => {
                    store.title('intermediate');
                    store.title('final');
                    store.update(draft => { draft.items[18].done = true; });
                };
                if (mode === 'transaction') transaction(write);
                else write();
            }
            flush();
            expect(history.kinds()).toEqual(['patches']);
            expect([store.captures, store.ownCalls]).toEqual([0, 0]);
            expect(history.undo()).toBe(true);
            flush();
            expect(store.getData().items[17].title).toBe('T17');
            expect(store.getData().items[18].done).toBe(false);
            expect(history.canUndo()).toBe(false);
            expect(history.redo()).toBe(true);
            flush();
            expect(store.getData().items[17].title).toBe('final');
            expect(store.getData().items[18].done).toBe(true);
            expect(store.getData().native).toBe(native);
            expect(history.kinds()).toEqual(['patches']);
        } finally { history.disconnect(); }
    });

    test('canceled scalar transaction preserves redo without capturing the native baseline', () => {
        const store = new CountedStore(makeState('date'));
        const history = new InspectedHistory(store);
        try {
            store.title('first');
            expect(history.undo()).toBe(true);
            store.reset();
            transaction(() => { store.title('temporary'); store.title('T17'); });
            expect(history.canUndo()).toBe(false);
            expect(history.canRedo()).toBe(true);
            expect([store.captures, store.ownCalls]).toEqual([0, 0]);
            expect(history.redo()).toBe(true);
            expect(store.getData().items[17].title).toBe('first');
        } finally { history.disconnect(); }
    });
});

describe('native scalar alias and fallback boundaries', () => {
    test('plain row also used as Map key/member and Set member keeps owned backlinks', () => {
        const row = {title: 'before'};
        const root = {row, map: new Map<unknown, object>([[row, row]]), set: new Set([row])};
        Object.defineProperty(root.map, 'owner', {
            value: root, enumerable: false, writable: false, configurable: true,
        });
        const store = new Carburetor(root);
        const history = new InspectedHistory(store);
        const check = (state: typeof root, title: string): void => {
            expect(state.row.title).toBe(title);
            expect(state.map.get(state.row)).toBe(state.row);
            expect([...state.set][0]).toBe(state.row);
            expect(Object.getOwnPropertyDescriptor(state.map, 'owner')).toMatchObject({
                value: state, enumerable: false, writable: false, configurable: true,
            });
        };
        try {
            store.update(draft => { draft.row.title = 'after'; });
            check(store.getData(), 'after');
            check(history.owned(), 'after');
            expect(history.kinds()).toEqual(['patches']);
            expect(history.undo()).toBe(true);
            check(store.getData(), 'before');
            check(history.owned(), 'before');
            expect(history.redo()).toBe(true);
            check(store.getData(), 'after');
            check(history.owned(), 'after');
            store.update(draft => { draft.map.set('extra', {title: 'native'}); });
            expect(history.kinds()).toEqual(['patches', 'snapshot']);
            expect(history.undo()).toBe(true);
            check(store.getData(), 'after');
            expect(history.undo()).toBe(true);
            check(store.getData(), 'before');
            expect(history.redo()).toBe(true);
            check(store.getData(), 'after');
            expect(history.redo()).toBe(true);
            check(store.getData(), 'after');
            expect(store.getData().map.has('extra')).toBe(true);
        } finally { history.disconnect(); }
    });

    test.each(['replace', 'map.set', 'map.delete', 'draft-read', 'mixed-date', 'mixed-replacement'])(
        '%s after a scalar step retains snapshot ownership and exact endpoints', operation => {
            const initial = {n: 0, date: new Date(100), map: new Map([['k', 1]])};
            const store = new Carburetor(initial);
            const history = new InspectedHistory(store);
            try {
                store.update(draft => { draft.n = 1; });
                store.update(draft => {
                    if (operation === 'replace') draft.date = new Date(200);
                    if (operation === 'map.set') draft.map.set('k', 2);
                    if (operation === 'map.delete') draft.map.delete('k');
                    if (operation === 'draft-read') { void draft.date.getTime(); draft.n = 2; }
                    if (operation === 'mixed-date') { draft.n = 2; draft.date.setTime(200); }
                    if (operation === 'mixed-replacement') { draft.n = 2; draft.date = new Date(200); }
                });
                expect(history.kinds()[1]).toBe('snapshot');
                const after = {
                    n: store.getData().n, time: store.getData().date.getTime(), map: [...store.getData().map],
                };
                expect(history.undo()).toBe(true);
                expect(store.getData().n).toBe(1);
                expect(store.getData().date.getTime()).toBe(100);
                expect([...store.getData().map]).toEqual([['k', 1]]);
                expect(history.undo()).toBe(true);
                expect(store.getData().n).toBe(0);
                expect(history.redo()).toBe(true);
                expect(store.getData().n).toBe(1);
                expect(history.redo()).toBe(true);
                expect({n: store.getData().n, time: store.getData().date.getTime(), map: [...store.getData().map]})
                    .toEqual(after);
                expect(history.kinds()[0]).toBe('patches');
            } finally { history.disconnect(); }
        }
    );

    test.each(['locked-array', 'restricted-field'])('%s stays descriptor-safe beside a native', boundary => {
        const values = [1, 2];
        const row = {n: 0};
        if (boundary === 'locked-array') Object.defineProperty(values, 'length', {writable: false});
        else Object.defineProperty(row, 'n', {writable: true, configurable: false, enumerable: true});
        const store = new Carburetor({values, row, date: new Date(100)});
        const history = new InspectedHistory(store);
        const check = (n: number): void => {
            const state = store.getData();
            expect(state.row.n).toBe(n);
            expect(state.values).toEqual([1, 2]);
            expect(state.date.getTime()).toBe(100);
            if (boundary === 'locked-array') {
                expect(Object.getOwnPropertyDescriptor(state.values, 'length')?.writable).toBe(false);
            } else {
                expect(Object.getOwnPropertyDescriptor(state.row, 'n')).toMatchObject({
                    writable: true, configurable: false, enumerable: true,
                });
            }
        };
        try {
            store.update(draft => { draft.row.n = 1; });
            check(1);
            expect(history.undo()).toBe(true);
            check(0);
            expect(history.redo()).toBe(true);
            check(1);
            if (boundary === 'locked-array') {
                expect(() => store.update(draft => { draft.values.push(3); })).toThrow(TypeError);
            } else {
                expect(() => store.update(draft => { delete (draft.row as {n?: number}).n; })).toThrow(TypeError);
            }
            check(1);
        } finally { history.disconnect(); }
    });
});
