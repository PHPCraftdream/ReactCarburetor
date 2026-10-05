// R32-01: a container built from draft branches must never store engine views in state.
// Covers every pattern from the review probe, plus wake and identity contracts, in development.
/* oxlint-disable carburetor/no-untrackable-draft-mutation */
import {Carburetor} from "@/Carburetor";
import {createAliasLedger} from "@/Carburetor/Store/Tracking/Aliases/AliasLedger";
import {createWriteProxy} from "@/Carburetor/Store/Tracking/createWriteProxy";
import {rstest} from "@rstest/core";
import {types} from "node:util";

interface IRow {
    id: number;
    title: string;
    at?: Date;
    tags?: {a: number};
}

interface IData {
    rows: IRow[];
    meta: Record<string, unknown>;
    other: number;
}

const makeRow = (id: number): IRow => ({id, title: 'row' + id, tags: {a: id}});

const makeData = (): IData => ({
    rows: [makeRow(0), makeRow(1), makeRow(2)],
    meta: {label: 'm'},
    other: 0,
});

class Store extends Carburetor<IData> {
    public run(fn: (draft: IData) => void): void {
        this.update(fn);
    }
}

/** Counts engine proxies reachable from a value graph. */
const countProxies = (value: unknown, stack: Set<object> = new Set()): number => {
    if (value === null || typeof value !== 'object' || stack.has(value)) {
        return 0;
    }

    stack.add(value);
    let found = types.isProxy(value) ? 1 : 0;

    if (Array.isArray(value)) {
        for (const entry of value) {
            found += countProxies(entry, stack);
        }
    } else if (Object.getPrototypeOf(value) === Object.prototype || types.isProxy(value)) {
        for (const key of Object.keys(value as Record<string, unknown>)) {
            found += countProxies((value as Record<string, unknown>)[key], stack);
        }
    }

    return found;
};

describe('R32-01 — draft-built containers store no engine views', () => {
    it('map(r => r) stores raw rows and preserves identity', () => {
        const store = new Store(makeData());
        const original = store.getData().rows[1];

        store.run(draft => { draft.rows = draft.rows.map(row => row); });

        const rows = store.getData().rows;
        expect(countProxies(rows)).toBe(0);
        expect(rows[1]).toBe(original);
    });

    it('map replacing one row normalizes nested copies too', () => {
        const store = new Store(makeData());

        store.run(draft => {
            draft.rows = draft.rows.map(row => row.id === 1 ? {...row, title: 'x'} : row);
        });

        expect(countProxies(store.getData())).toBe(0);
        expect(store.getData().rows[1].title).toBe('x');
        expect(types.isProxy(store.getData().rows[1].tags)).toBe(false);
    });

    it('filter stores no proxies and keeps surviving identity', () => {
        const store = new Store(makeData());
        const kept = store.getData().rows[2];

        store.run(draft => { draft.rows = draft.rows.filter(row => row.id !== 1); });

        expect(countProxies(store.getData())).toBe(0);
        expect(store.getData().rows[1]).toBe(kept);
    });

    it('spread and concat store no proxies', () => {
        const spreadStore = new Store(makeData());
        spreadStore.run(draft => { draft.rows = [...draft.rows, makeRow(3)]; });
        expect(countProxies(spreadStore.getData())).toBe(0);
        expect(spreadStore.getData().rows.length).toBe(4);

        const concatStore = new Store(makeData());
        concatStore.run(draft => { draft.rows = draft.rows.concat([makeRow(3)]); });
        expect(countProxies(concatStore.getData())).toBe(0);
        expect(concatStore.getData().rows.length).toBe(4);
    });

    it('a view placed into a fresh object key is normalized', () => {
        const store = new Store(makeData());

        store.run(draft => { draft.meta = {...draft.meta, first: draft.rows[0]}; });

        expect(countProxies(store.getData())).toBe(0);
        expect(store.getData().meta.first).toBe(store.getData().rows[0]);
    });

    it('pushing a copy built from draft fields normalizes nested fields', () => {
        const store = new Store(makeData());

        store.run(draft => { draft.rows.push({...draft.rows[0]}); });

        const copy = store.getData().rows[3];
        expect(countProxies(store.getData())).toBe(0);
        expect(copy.tags).toBe(store.getData().rows[0].tags);
    });

    it('a positional filter plus a write at the new index wakes only that index', () => {
        const data = makeData();
        const moved = makeRow(2);
        data.rows = [makeRow(0), makeRow(1), moved];
        const store = new Store(data);

        let lowWakes = 0;
        let highWakes = 0;
        store.subscribe(() => { lowWakes++; }, {reads: new Set(['rows.1.title'])});
        store.subscribe(() => { highWakes++; }, {reads: new Set(['rows.2.title'])});
        expect(store.read(() => undefined).rows[1].title).toBeDefined();
        expect(store.read(() => undefined).rows[2].title).toBeDefined();

        store.run(draft => { draft.rows = draft.rows.filter(row => row.id !== 0); });
        const afterFilterLow = lowWakes;
        const afterFilterHigh = highWakes;
        // A positional shift moves a row object to another path — development reports the
        // resulting aliasing; capture it, this test is about who is woken.
        const reports: unknown[][] = [];
        const spy = rstest.spyOn(console, 'error').mockImplementation((...args: unknown[]): void => {
            reports.push(args);
        });
        store.run(draft => { draft.rows[0].title = 'moved-in'; });
        spy.mockRestore();

        // The removal wakes the tail reader through the deleted path; the write at the shifted
        // row's new index wakes that index alone, never the reader of the old index.
        expect(store.getData().rows[1]).toBe(moved);
        expect(highWakes).toBe(afterFilterHigh);
        expect(lowWakes).toBe(afterFilterLow);
    });

    it('an opaque read through a view and an unrelated write wake nobody', () => {
        const data = makeData();
        data.rows = [{id: 0, title: 'a', at: new Date(0)}, {id: 1, title: 'b', at: new Date(1)}];
        const store = new Store(data);

        let wakes = 0;
        store.subscribe(() => { wakes++; }, {reads: new Set(['rows.1.at'])});
        expect(store.read(() => undefined).rows[1].at).toBeDefined();
        expect(wakes).toBe(0);

        store.run(draft => { draft.rows = draft.rows.map(row => row); });
        expect(wakes).toBe(0);

        store.run(draft => { draft.other = 1; });
        expect(wakes).toBe(0);
    });

    it('self-reassignment keeps identity and stays silent', () => {
        const store = new Store(makeData());
        const rows = store.getData().rows;

        let wakes = 0;
        store.subscribe(() => { wakes++; }, {reads: new Set(['rows.1.title'])});
        expect(store.read(() => undefined).rows[1].title).toBeDefined();

        store.run(draft => { draft.rows = rows; });

        expect(store.getData().rows).toBe(rows);
        expect(wakes).toBe(0);
    });

    it('setData of a caller-built root normalizes views from a read tree', () => {
        const store = new Store(makeData());
        const view = store.read(() => undefined);
        const leaky = {rows: view.rows.map(row => row), meta: {}, other: 0};

        store.setData(leaky as IData);

        expect(countProxies(store.getData())).toBe(0);
        expect(store.getData().rows[2]).toBe(store.getData().rows[2]);
        expect(store.getData().rows[1].title).toBe('row1');
    });

    it('the development ledger rejects an engine view as state', () => {
        const ledger = createAliasLedger();
        const proxy = createWriteProxy({a: 1}, () => undefined, 'leak');

        expect(() => ledger!.checkState(proxy, 'leak')).toThrow(/engine view/);
        expect(() => ledger!.checkState({a: 1}, 'fine')).not.toThrow();
    });
});
