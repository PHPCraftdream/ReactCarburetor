import {Carburetor} from '@/Carburetor';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {id: number; value: {n: number};}
interface IData {rows: IRow[]; dictionary: Record<string, IRow>; other: number;}
interface IDataWithNested {rows: IRow[][]; dictionary: Record<string, IRow>; other: number;}
const COUNT = 10000;

class SelectionStore extends Carburetor<IData> {
    public recordedPaths: string[] = [];

    /** Records selection dependency paths.
     *
     * @param record - callback receiving each path
     */
    public override read(record: Parameters<Carburetor<IData>['read']>[0]): ReturnType<Carburetor<IData>['read']> {
        return super.read((path) => { this.recordedPaths.push(path); record(path); });
    }

    /** Runs one state mutation.
     *
     * @param fn - mutation callback
     */
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

const makeStore = (): SelectionStore => {
    const rows = Array.from({length: COUNT}, (_, id) => ({id, value: {n: id}}));
    return new SelectionStore({rows, dictionary: Object.fromEntries(rows.map((row) => [String(row.id), {
        id: row.id, value: {n: row.value.n},
    }])), other: 0});
};

/** Collects changes from a watch on the selected rows.
 *
 * @param store - store whose rows are selected
 * @param onChange - callback receiving each detached row snapshot
 * @returns function that releases the watch
 */
const observeRows = (store: SelectionStore, onChange: (next: IRow[], previous: IRow[]) => void): (() => void) =>
    store.watch((data: IData) => data.rows, onChange);

describe('structural selection reconciliation', () => {
    test('structural no-op produces the same value as a full reconciliation', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = observeRows(store, (next) => seen.push(next));
        store.change((draft) => { draft.rows[0].value.n = -1; });
        const previous = seen[0];
        const originalError = console.error;
        try {
            console.error = () => undefined;
            store.change((draft) => {
                draft.rows.push({id: COUNT, value: {n: COUNT}});
                draft.rows.pop();
            });
        } finally {
            console.error = originalError;
        }
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(previous);
        expect(store.getData().rows).toEqual(previous);
        stop();
    });

    test.each([
        ['append', 3, 6],
        ['pop', 0, 0],
    ] as const)('%s reads only the changed rows, not every selected descendant', (operation, nested, members) => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = observeRows(store, (next) => seen.push(next));
        store.recordedPaths = [];
        store.change((draft) => {
            if (operation === 'append') draft.rows.push({id: COUNT, value: {n: COUNT}});
            else draft.rows.pop();
        });
        const nestedPaths = store.recordedPaths.filter((path) => /^rows[./][0-9]+[./][^./]+[./]/.test(path));
        const memberPaths = store.recordedPaths.filter((path) => /^rows[./][0-9]+[./]/.test(path));
        expect(nestedPaths.length).toBeLessThanOrEqual(nested);
        expect(memberPaths.length).toBeLessThanOrEqual(members);
        expect(seen).toHaveLength(1);
        expect(seen[0]).toStrictEqual(store.getData().rows);
        stop();
    });

    test('proof path and fallback produce equivalent mixed structural and nested results', () => {
        const fast = makeStore();
        const fallback = makeStore();
        Object.defineProperty(fallback, CARBURETOR_PATHS_SINCE, {value: undefined});
        const fastValues: IRow[][] = [];
        const fallbackValues: IRow[][] = [];
        const stopFast = observeRows(fast, (next) => fastValues.push(next));
        const stopFallback = observeRows(fallback, (next) => fallbackValues.push(next));
        const edit = (draft: IData): void => {
            draft.rows[COUNT - 1].value.n = -1;
            draft.rows.push({id: COUNT, value: {n: COUNT}});
        };
        fast.change(edit);
        fallback.change(edit);
        expect(fastValues[0]).toEqual(fallbackValues[0]);
        expect(fastValues[0][0]).toBeDefined();
        expect(fastValues[0][COUNT - 1].value.n).toBe(-1);
        expect(fallbackValues[0][COUNT - 1].value.n).toBe(-1);
        stopFast();
        stopFallback();
    });

    test('mixed array operations match forced full reconciliation', () => {
        const make = (): SelectionStore => new SelectionStore({
            rows: [
                {id: 0, value: {n: 0}},
                {id: 1, value: {n: 1}},
                {id: 2, value: {n: 2}},
            ], dictionary: {}, other: 0,
        });
        const fast = make();
        const fallback = make();
        Object.defineProperty(fallback, CARBURETOR_PATHS_SINCE, {value: undefined});
        /** Opens a watch and collects its snapshots.
         *
         * @param watchedStore - store being watched
         * @returns snapshots and a disposer
         */
        const collect = (watchedStore: SelectionStore): {seen: IRow[][]; stop: () => void} => {
            const seen: IRow[][] = [];
            const stop = watchedStore.watch((data: IData) => data.rows, (next) => seen.push(next));
            return {seen, stop};
        };
        const fastWatch = collect(fast);
        const fallbackWatch = collect(fallback);
        const fastSeen = fastWatch.seen;
        const fallbackSeen = fallbackWatch.seen;
        /** Applies the mixed operation sequence under test.
         *
         * @param draft - mutable array state
         */
        const sequence = (draft: IData): void => {
            draft.rows.push({id: 3, value: {n: 3}});
            draft.rows.pop();
            draft.rows.unshift({id: 4, value: {n: 4}});
            draft.rows.splice(1, 1, {id: 5, value: {n: 5}});
            draft.rows.sort((left, right) => left.id - right.id);
            draft.rows[0].value.n++;
        };
        const originalError = console.error;
        try {
            console.error = () => undefined;
            fast.change(sequence);
            fallback.change(sequence);
        } finally {
            console.error = originalError;
            fastWatch.stop();
            fallbackWatch.stop();
        }
        expect(fastSeen[0]).toEqual(fallbackSeen[0]);
        expect(fastSeen[0].map((row) => row.id)).toEqual([1, 2, 4, 5]);
    });

    test('selected nested array append retains unchanged branches', () => {
        const nested = new SelectionStore({
            rows: [[{id: 0, value: {n: 0}}], [{id: 1, value: {n: 1}}]],
            dictionary: {}, other: 0,
        } as unknown as IData);
        let latest: IRow[][] = [];
        const stop = nested.watch((data: IDataWithNested) => data.rows, (next) => { latest = next; });
        nested.change((draft) => { (draft.rows as unknown as IRow[][])[1].push({id: 2, value: {n: 2}}); });
        expect(latest[0][0].id).toBe(0);
        expect(latest[1].map((row) => row.id)).toEqual([1, 2]);
        stop();
    });

    test('append preserves sparse holes and own undefined', () => {
        const rows: Array<IRow | undefined> = [];
        rows.length = 8;
        rows[0] = {id: 0, value: {n: 0}};
        rows[7] = undefined;
        const store = new SelectionStore({rows: rows as IRow[], dictionary: {}, other: 0});
        let latest: IRow[] = [];
        const stop = observeRows(store, (next) => { latest = next; });
        store.change((draft) => { draft.rows.push({id: 8, value: {n: 8}}); });
        expect(6 in latest).toBe(false);
        expect(7 in latest).toBe(true);
        expect(latest[7]).toBeUndefined();
        stop();
    });

    test('append preserves own enumerable key order for selected dictionaries', () => {
        const store = makeStore();
        let latest: Record<string, IRow> = {};
        const stop = store.watch((data: IData) => data.dictionary, (next) => { latest = next; });
        store.change((draft) => { draft.dictionary.new = {id: COUNT, value: {n: COUNT}}; });
        expect(Object.keys(latest).slice(0, 3)).toEqual(['0', '1', '2']);
        expect(Object.keys(latest).slice(-1)).toEqual(['new']);
        stop();
    });

    test('dictionary insertion and deletion match the store', () => {
        const store = makeStore();
        let latest: Record<string, IRow> = {};
        const stop = store.watch((data: IData) => data.dictionary, (next) => { latest = next; });
        store.change((draft) => {
            delete draft.dictionary['1'];
            draft.dictionary.new = {id: COUNT, value: {n: COUNT}};
        });
        expect(Object.keys(latest)).toHaveLength(COUNT);
        expect('1' in latest).toBe(false);
        expect(latest.new.value.n).toBe(COUNT);
        expect(latest).toEqual(store.getData().dictionary);
        stop();
    });

    test.each(['replace-append', 'replace-append-write'])('write sequence %s matches fallback', (sequence) => {
        const fast = makeStore();
        const fallback = makeStore();
        Object.defineProperty(fallback, CARBURETOR_PATHS_SINCE, {value: undefined});
        const fastValues: IRow[][] = [];
        const fallbackValues: IRow[][] = [];
        const stopFast = observeRows(fast, (next) => fastValues.push(next));
        const stopFallback = observeRows(fallback, (next) => fallbackValues.push(next));
        const edit = (draft: IData): void => {
            draft.rows[3] = {id: 30, value: {n: 30}};
            draft.rows.push({id: COUNT, value: {n: COUNT}});
            if (sequence === 'replace-append-write') draft.rows[COUNT].value.n++;
        };
        fast.change(edit);
        fallback.change(edit);
        expect(fastValues[0]).toEqual(fallbackValues[0]);
        stopFast();
        stopFallback();
    });

    test('separate append and inner write deliver current values without changing prior snapshot', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = observeRows(store, (next) => seen.push(next));
        store.change((draft) => { draft.rows.push({id: COUNT, value: {n: 0}}); });
        store.change((draft) => { draft.rows[COUNT].value.n = 99; });
        expect(seen).toHaveLength(2);
        expect(seen[1][COUNT].value.n).toBe(99);
        expect(seen[0][COUNT].value.n).toBe(0);
        stop();
    });

    test('pop and reinsert same row remains detached', () => {
        const store = makeStore();
        const row = {id: COUNT, value: {n: 1}};
        store.change((draft) => { draft.rows.push(row); });
        const seen: IRow[][] = [];
        const stop = observeRows(store, (next) => seen.push(next));
        store.change((draft) => { draft.rows.pop(); });
        store.change((draft) => { draft.rows.push(row); });
        expect(seen[1][COUNT].value.n).toBe(1);
        stop();
    });

    test('duplicate raw row topology reports warning and completes safely', () => {
        const store = new SelectionStore({rows: [{id: 1, value: {n: 1}}], dictionary: {}, other: 0});
        const originalError = console.error;
        const warnings: unknown[][] = [];
        let stop: (() => void) | undefined;
        try {
            console.error = (...args: unknown[]): void => { warnings.push(args); };
            stop = observeRows(store, () => undefined);
            store.change((draft) => { draft.rows.push(draft.rows[0]); });
        } finally {
            console.error = originalError;
            stop?.();
        }
        expect(warnings.length).toBeGreaterThan(0);
    });

    test('new row backlink to existing descendant warns instead of claiming tree shape', () => {
        const store = new SelectionStore({rows: [{id: 0, value: {n: 0}}], dictionary: {}, other: 0});
        const originalError = console.error;
        const warnings: unknown[][] = [];
        let stop: (() => void) | undefined;
        try {
            console.error = (...args: unknown[]): void => { warnings.push(args); };
            stop = observeRows(store, () => undefined);
            store.change((draft) => {
                const linked = {id: 1, value: {n: 1}} as IRow & {back?: object};
                linked.back = draft.rows[0].value;
                draft.rows.push(linked);
            });
        } finally {
            console.error = originalError;
            stop?.();
        }
        expect(warnings.length).toBeGreaterThan(0);
    });
});
