import {Carburetor, CarburetorHistory} from '@/Carburetor';
import {isSafeScalarPatch} from '@/Carburetor/Tooling/Graph/isSafeScalarPatch';

class InspectedHistory<T extends object> extends CarburetorHistory<T> {
    public kinds(): string[] { return this.past.map(entry => entry.kind); }
    public endpoints(): unknown[] {
        return this.past.flatMap(entry => entry.kind === 'snapshot' ? [entry.before, entry.after] : []);
    }
}

test('null prototype and array scalar leaves are patches beside a native', () => {
    const row = Object.assign(Object.create(null), {n: 0}) as {n: number};
    const store = new Carburetor({rows: [row], values: [1], date: new Date(100)});
    const history = new InspectedHistory(store);
    try {
        store.update(draft => { draft.rows[0].n = 2; draft.values[0] = 3; });
        expect(history.kinds()).toEqual(['patches']);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[0].n).toBe(0);
        expect(store.getData().values[0]).toBe(1);
        expect(history.redo()).toBe(true);
        expect(store.getData().rows[0].n).toBe(2);
        expect(store.getData().values[0]).toBe(3);
    } finally { history.disconnect(); }
});

test.each(['add', 'delete', 'length', 'function'])('%s stays a snapshot beside a native', kind => {
    const row: {n?: number; extra?: number; fn?: () => number} = {n: 0};
    if (kind === 'function') row.fn = () => 0;
    const store = new Carburetor({row, values: [1, 2], date: new Date(100)});
    const history = new InspectedHistory(store);
    try {
        store.update(draft => {
            if (kind === 'add') draft.row.extra = 1;
            if (kind === 'delete') delete draft.row.n;
            if (kind === 'length') draft.values.length = 1;
            if (kind === 'function') draft.row.fn = () => 1;
        });
        expect(history.kinds()).toEqual(['snapshot']);
        expect(history.undo()).toBe(true);
        expect(store.getData().row.n).toBe(0);
        expect(store.getData().values).toEqual([1, 2]);
        if (kind === 'function') expect(store.getData().row.fn?.()).toBe(0);
        expect(history.redo()).toBe(true);
    } finally { history.disconnect(); }
});

test('snapshot endpoints are detached before following scalar writes', () => {
    const store = new Carburetor({n: 0, date: new Date(100)});
    const history = new InspectedHistory(store);
    try {
        store.update(draft => { draft.date = new Date(200); });
        const endpoints = history.endpoints();
        store.update(draft => { draft.n = 1; });
        store.update(draft => { draft.n = 2; });
        expect(history.kinds()).toEqual(['snapshot', 'patches', 'patches']);
        expect(endpoints).toEqual([{n: 0, date: new Date(100)}, {n: 0, date: new Date(200)}]);
        expect(history.undo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(history.undo()).toBe(true);
        expect(store.getData()).toEqual({n: 0, date: new Date(100)});
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({n: 0, date: new Date(200)});
        expect(history.redo()).toBe(true);
        expect(history.redo()).toBe(true);
        expect(store.getData()).toEqual({n: 2, date: new Date(200)});
        expect(endpoints).toEqual([{n: 0, date: new Date(100)}, {n: 0, date: new Date(200)}]);
    } finally { history.disconnect(); }
});

test('custom restore fallback adopts native scalar patch graph aliases', () => {
    const row = {n: 0};
    const state = {row, map: new Map([[row, row]]), set: new Set([row])};
    class CustomStore extends Carburetor<typeof state> {
        public restores = 0;
        public restore(value: typeof state): void { this.restores++; super.restore(value); }
    }
    const store = new CustomStore(state);
    const history = new InspectedHistory(store);
    const check = (n: number): void => {
        const current = store.getData();
        expect(current.row.n).toBe(n);
        expect(current.map.get(current.row)).toBe(current.row);
        expect([...current.set][0]).toBe(current.row);
    };
    try {
        store.update(draft => { draft.row.n = 1; });
        expect(history.kinds()).toEqual(['patches']);
        expect(history.undo()).toBe(true);
        check(0);
        expect(history.redo()).toBe(true);
        check(1);
        expect(store.restores).toBe(2);
        expect(history.kinds()).toEqual(['patches']);
    } finally { history.disconnect(); }
});

test('scalar admission rejects accessors without reading them and validates inverse endpoints', () => {
    let reads = 0;
    const root = {get n(): number { reads++; return 0; }};
    const patch = {segments: ['n'], previous: 0, next: 1, previousExists: true, nextExists: true};
    expect(isSafeScalarPatch(root, patch)).toBe(false);
    expect(reads).toBe(0);
    const hidden = Object.defineProperty({}, 'n', {value: 0, writable: true, configurable: true});
    expect(isSafeScalarPatch(hidden, patch)).toBe(false);
    const restricted = Object.defineProperty({}, 'n', {value: 0, writable: true, enumerable: true});
    expect(isSafeScalarPatch(restricted, patch)).toBe(false);
    expect(isSafeScalarPatch({values: [0]}, {...patch, segments: ['values', 'length']})).toBe(false);
    expect(isSafeScalarPatch({n: 1}, patch, true)).toBe(true);
    expect(isSafeScalarPatch({n: 1}, {...patch, previous: () => 0}, true)).toBe(false);
    expect(isSafeScalarPatch({n: 1}, {...patch, previousExists: false}, true)).toBe(false);
});
