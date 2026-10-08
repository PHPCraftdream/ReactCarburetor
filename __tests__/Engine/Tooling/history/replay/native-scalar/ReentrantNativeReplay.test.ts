import {Carburetor, CarburetorHistory, ComponentUpdateThrottle, transaction} from '@/Carburetor';

interface IState { n: number; date: Date; map: Map<string, number>; plain: number; }
type Operation = 'date' | 'map' | 'plain';
type Direction = 'undo' | 'redo';

const initial = (): IState => ({n: 0, date: new Date(100), map: new Map([['k', 1]]), plain: 0});
const values = (state: IState): object => ({
    n: state.n, date: state.date.getTime(), map: [...state.map], plain: state.plain,
});
const expected = (n: number, operation?: Operation): object => ({
    n, date: operation === 'date' ? 200 : 100,
    map: [['k', operation === 'map' ? 2 : 1]], plain: operation === 'plain' ? 2 : 0,
});

class NativeStore extends Carburetor<IState> {
    public scalars(): void { this.update(draft => { draft.n = 1; draft.plain = 1; }); }
    public scalar(n: number): void { this.update(draft => { draft.n = n; }); }
    public mutateNatives(): void {
        this.update(draft => { draft.date.setTime(300); draft.map.set('k', 3); });
    }
    public branch(operation: Operation): void {
        this.update(draft => {
            if (operation === 'date') draft.date = new Date(200);
            if (operation === 'map') draft.map.set('k', 2);
            if (operation === 'plain') draft.plain = 2;
        });
    }
}

class InspectedHistory extends CarburetorHistory<IState> {
    public owned(): IState { return this.baseline; }
    public kinds(): string[] { return this.past.map(entry => entry.kind); }
    public cursor(): number[] { return [this.past.length, this.future.length]; }
    public snapshots(): {before: IState; after: IState}[] {
        return [...this.past, ...this.future].flatMap(entry =>
            entry.kind === 'snapshot' ? [{before: entry.before, after: entry.after}] : []);
    }
}

const setup = (direction: Direction, operation: Operation) => {
    const store = new NativeStore(initial());
    const history = new InspectedHistory(store);
    store.scalar(1);
    expect(history.kinds()).toEqual(['patches']);
    if (direction === 'redo') {
        store.scalar(2);
        expect(history.undo()).toBe(true);
        expect(history.undo()).toBe(true);
    }
    let calls = 0;
    const subscription = store.subscribe(() => {
        if (calls === 0 && store.getData().n === (direction === 'undo' ? 0 : 1)) {
            calls++;
            store.branch(operation);
        }
    }, {reads: new Set(['n'])});
    return {
        store, history,
        replay: (): void => {
            expect(history[direction]()).toBe(true);
            expect(calls).toBe(1);
        },
        close: (): void => { store.unsubscribe(subscription); history.disconnect(); },
    };
};

// R39-02: synchronous native branches must start from the installed scalar replay endpoint.
describe.each(['undo', 'redo'] as const)('%s reentrant scalar replay', direction => {
    test.each(['date', 'map', 'plain'] as const)('%s branch baseline and owned endpoints', operation => {
        const {store, history, replay, close} = setup(direction, operation);
        const n = direction === 'undo' ? 0 : 1;
        try {
            replay();
            expect(values(store.getData())).toEqual(expected(n, operation));
            expect(values(history.owned())).toEqual(values(store.getData()));
            expect(history.cursor()).toEqual(direction === 'undo' ? [1, 0] : [2, 0]);
            expect(history.canRedo()).toBe(false);
            expect(history.kinds()).toEqual(operation === 'plain'
                ? (direction === 'undo' ? ['patches'] : ['patches', 'patches'])
                : (direction === 'undo' ? ['snapshot'] : ['patches', 'snapshot']));
            if (operation !== 'plain') {
                const [snapshot] = history.snapshots();
                expect(values(snapshot.before)).toEqual(expected(n));
                expect(values(snapshot.after)).toEqual(expected(n, operation));
                expect(snapshot.before.date).not.toBe(store.getData().date);
                expect(snapshot.before.map).not.toBe(store.getData().map);
                expect(snapshot.after.date).not.toBe(store.getData().date);
                expect(snapshot.after.map).not.toBe(store.getData().map);
                expect(snapshot.before).not.toBe(history.owned());
                expect(snapshot.after).not.toBe(history.owned());
            }
        } finally { close(); }
    });

    test.each(['date', 'map', 'plain'] as const)('%s branch undo/redo is exact and snapshots immutable', operation => {
        const {store, history, replay, close} = setup(direction, operation);
        const n = direction === 'undo' ? 0 : 1;
        try {
            replay();
            const snapshots = history.snapshots();
            const endpoints = snapshots.flatMap(entry => [entry.before, entry.after]);
            const retained = endpoints.map(values);
            expect(history.canRedo()).toBe(false);
            expect(history.undo()).toBe(true);
            expect(values(store.getData())).toEqual(expected(n));
            expect(values(history.owned())).toEqual(expected(n));
            expect(history.cursor()).toEqual(direction === 'undo' ? [0, 1] : [1, 1]);
            expect(history.redo()).toBe(true);
            expect(values(store.getData())).toEqual(expected(n, operation));
            expect(values(history.owned())).toEqual(expected(n, operation));
            expect(history.redo()).toBe(false);
            expect(endpoints.map(values)).toEqual(retained);
            if (direction === 'redo') {
                expect(history.undo()).toBe(true);
                expect(history.undo()).toBe(true);
                expect(values(store.getData())).toEqual(expected(0));
                expect(history.redo()).toBe(true);
                expect(history.redo()).toBe(true);
                expect(values(store.getData())).toEqual(expected(1, operation));
            }
            store.scalar(3);
            store.mutateNatives();
            expect(endpoints.map(values)).toEqual(retained);
        } finally { close(); }
    });
});

class ManualThrottle extends ComponentUpdateThrottle {
    protected setupTimeout(): void {}
    public flush(): void { this.letsUpdate(); }
}

test.each(['sync', 'transaction', 'throttle'] as const)(
    '%s partial multi-patch failure reconciles before subscriber native branch', mode => {
        const throttle = mode === 'throttle' ? new ManualThrottle() : undefined;
        const store = new NativeStore(initial(), throttle);
        const history = new InspectedHistory(store);
        let dispose = (): void => {};
        let branched = false;
        const subscription = store.subscribe(() => {
            if (!branched && store.getData().plain === 0) { branched = true; store.branch('date'); }
        }, {reads: new Set(['plain'])});
        try {
            store.scalars();
            throttle?.flush();
            dispose = store.attachPatchListener({patch: patch => {
                if (typeof patch !== 'symbol' && patch.segments[0] === 'plain') {
                    throw new Error('partial replay');
                }
            }});
            const undo = (): void => { expect(() => history.undo()).toThrow('partial replay'); };
            if (mode === 'transaction') transaction(undo);
            else undo();
            dispose();
            throttle?.flush();
            expect(values(store.getData())).toEqual({...expected(1, 'date'), plain: 0});
            expect(values(history.owned())).toEqual(values(store.getData()));
            expect(values(history.snapshots()[0].before)).toEqual(expected(1));
            expect(history.canRedo()).toBe(false);
            expect(history.undo()).toBe(true);
            throttle?.flush();
            expect(values(store.getData())).toEqual(expected(1));
        } finally { dispose(); store.unsubscribe(subscription); history.disconnect(); }
    }
);

test('same-path subscriber write is not overwritten after scalar undo', () => {
    const store = new NativeStore(initial());
    const history = new InspectedHistory(store);
    store.scalar(1);
    let branched = false;
    const subscription = store.subscribe(() => {
        if (!branched && store.getData().n === 0) { branched = true; store.scalar(2); }
    }, {reads: new Set(['n'])});
    try {
        expect(history.undo()).toBe(true);
        expect(values(history.owned())).toEqual(expected(2));
        expect(history.canRedo()).toBe(false);
        expect(history.undo()).toBe(true);
        expect(values(store.getData())).toEqual(expected(0));
        expect(history.redo()).toBe(true);
        expect(values(store.getData())).toEqual(expected(2));
    } finally { store.unsubscribe(subscription); history.disconnect(); }
});

test('nested scalar undo does not reinstall the outer baseline', () => {
    const store = new NativeStore(initial());
    const history = new InspectedHistory(store);
    store.scalar(1);
    store.scalar(2);
    let nested = false;
    const subscription = store.subscribe(() => {
        if (!nested && store.getData().n === 1) {
            nested = true;
            expect(history.undo()).toBe(true);
            store.branch('map');
        }
    }, {reads: new Set(['n'])});
    try {
        expect(history.undo()).toBe(true);
        expect(values(history.owned())).toEqual(expected(0, 'map'));
        expect(values(history.snapshots()[0].before)).toEqual(expected(0));
        expect(history.cursor()).toEqual([1, 0]);
        expect(history.undo()).toBe(true);
        expect(values(store.getData())).toEqual(expected(0));
        expect(history.redo()).toBe(true);
        expect(values(store.getData())).toEqual(expected(0, 'map'));
    } finally { store.unsubscribe(subscription); history.disconnect(); }
});

test.each(['undo', 'redo'] as const)('%s internal draft refusal reconciles staged baseline', direction => {
    class RefusedDraft extends NativeStore {
        public refuse = false;
        protected get draft(): IState {
            if (this.refuse) throw new Error('draft refused');
            return super.draft;
        }
    }
    const store = new RefusedDraft(initial());
    const history = new InspectedHistory(store);
    try {
        store.scalar(1);
        if (direction === 'redo') expect(history.undo()).toBe(true);
        const cursor = history.cursor();
        const before = values(store.getData());
        store.refuse = true;
        expect(() => history[direction]()).toThrow('draft refused');
        expect(values(store.getData())).toEqual(before);
        expect(values(history.owned())).toEqual(before);
        expect(history.cursor()).toEqual(cursor);
        store.refuse = false;
        expect(history[direction]()).toBe(true);
        expect(values(history.owned())).toEqual(values(store.getData()));
    } finally { history.disconnect(); }
});

class FailingRestoreStore extends NativeStore {
    public failure: 'before' | 'after' | undefined;
    public restore(state: IState): void {
        if (this.failure === 'before') throw new Error('before installation');
        super.restore(state);
        if (this.failure === 'after') throw new Error('after installation');
    }
}

describe('scalar replay failures with native baselines', () => {
    test.each(['undo', 'redo'] as const)('%s pre-install restore failure preserves cursor and baseline', direction => {
        const store = new FailingRestoreStore(initial());
        const history = new InspectedHistory(store);
        try {
            store.scalar(1);
            if (direction === 'redo') expect(history.undo()).toBe(true);
            const live = store.getData();
            const baseline = values(history.owned());
            const cursor = history.cursor();
            const version = store.getVersion();
            store.failure = 'before';
            expect(() => history[direction]()).toThrow('before installation');
            expect(store.getData()).toBe(live);
            expect(store.getVersion()).toBe(version);
            expect(values(history.owned())).toEqual(baseline);
            expect(history.cursor()).toEqual(cursor);
            store.failure = undefined;
            expect(history[direction]()).toBe(true);
            expect(values(history.owned())).toEqual(values(store.getData()));
        } finally { history.disconnect(); }
    });

    test.each(['undo', 'redo'] as const)('%s installed restore failure keeps the installed cursor', direction => {
        const store = new FailingRestoreStore(initial());
        const history = new InspectedHistory(store);
        try {
            store.scalar(1);
            if (direction === 'redo') expect(history.undo()).toBe(true);
            store.failure = 'after';
            expect(() => history[direction]()).toThrow('after installation');
            const n = direction === 'undo' ? 0 : 1;
            expect(values(store.getData())).toEqual(expected(n));
            expect(values(history.owned())).toEqual(expected(n));
            expect(history.cursor()).toEqual(direction === 'undo' ? [0, 1] : [1, 0]);
            store.failure = undefined;
            store.branch('date');
            expect(values(history.snapshots()[0].before)).toEqual(expected(n));
            expect(history.canRedo()).toBe(false);
            expect(history.undo()).toBe(true);
            expect(values(store.getData())).toEqual(expected(n));
        } finally { history.disconnect(); }
    });

    test.each(['undo', 'redo'] as const)(
        '%s installed draft patch observer failure still advances baseline', direction => {
        const store = new NativeStore(initial());
        const history = new InspectedHistory(store);
        let dispose = (): void => {};
        try {
            store.scalar(1);
            if (direction === 'redo') expect(history.undo()).toBe(true);
            dispose = store.attachPatchListener({patch: patch => {
                if (typeof patch !== 'symbol' && patch.segments[0] === 'n') {
                    throw new Error('installed scalar patch');
                }
            }});
            expect(() => history[direction]()).toThrow('installed scalar patch');
            const n = direction === 'undo' ? 0 : 1;
            expect(values(store.getData())).toEqual(expected(n));
            expect(history.cursor()).toEqual(direction === 'undo' ? [0, 1] : [1, 0]);
            expect(values(history.owned())).toEqual(expected(n));
            dispose();
            store.branch('date');
            expect(values(history.snapshots()[0].before)).toEqual(expected(n));
            expect(history.undo()).toBe(true);
            expect(values(store.getData())).toEqual(expected(n));
        } finally { dispose(); history.disconnect(); }
    });
});
