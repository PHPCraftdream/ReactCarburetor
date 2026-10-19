import {Carburetor} from '@/Carburetor';
import {CARBURETOR_PATHS_SINCE} from '@/Carburetor/Store/Utils/Models';

interface IRow {id: string; value: {x: number};}
interface IData {rows: IRow[]; lookup: {byId: Record<string, IRow>}; other: number;}

class ReaddStore extends Carburetor<IData> {
    /** Runs one transaction.
     *
     * @param fn - draft mutation
     */
    public change(fn: (draft: IData) => void): void { this.update(fn); }
}

/** One store and the snapshots its `rows` watch delivered, with their previous values.
 *
 * @param forced - disable the write log, so every wake reconciles in full
 * @param aliased - also keep each row under `lookup.byId`
 * @returns the store, the deliveries and a disposer
 */
const open = (forced: boolean, aliased: boolean): {
    store: ReaddStore; next: IRow[][]; previous: IRow[][]; stop: () => void;
} => {
    const a: IRow = {id: 'a', value: {x: 1}};
    const b: IRow = {id: 'b', value: {x: 2}};
    const store = new ReaddStore({rows: [a, b], lookup: {byId: aliased ? {a, b} : {}}, other: 0});
    if (forced) Object.defineProperty(store, CARBURETOR_PATHS_SINCE, {value: undefined});
    const next: IRow[][] = [];
    const previous: IRow[][] = [];
    const stop = store.watch((data: IData) => data.rows, (value, before) => {
        next.push(value);
        previous.push(before);
    });
    return {store, next, previous, stop};
};

/** Runs `body` with development alias warnings silenced; the aliasing is deliberate here.
 *
 * @param body - the scenario
 */
const quietly = (body: () => void): void => {
    const originalError = console.error;
    try {
        console.error = () => undefined;
        body();
    } finally {
        console.error = originalError;
    }
};

describe('a popped raw row pushed back', () => {
    test.each([false, true])('gets its previous copy back when unchanged (forced full walk: %s)', (forced) => {
        const side = open(forced, false);
        const b = side.store.getData().rows[1];
        side.store.change((draft) => { draft.rows.pop(); });
        const oldCopy = side.previous[0][1];
        side.store.change((draft) => { draft.rows.push(b); });
        side.stop();
        const readded = side.next[1][1];
        expect(readded).toStrictEqual({id: 'b', value: {x: 2}});
        // The patch keeps the ledger entry of a removed row, so the full reconcile it falls back to reuses
        // that copy; an always-full walk has dropped it and copies afresh. Values are the same either way.
        expect(readded === oldCopy).toBe(!forced);
        expect(readded.value === oldCopy.value).toBe(!forced);
    });

    test.each([false, true])('carries a write made while it was off the list (forced full walk: %s)', (forced) => {
        const side = open(forced, true);
        quietly(() => {
            const b = side.store.getData().rows[1];
            side.store.change((draft) => { draft.rows.pop(); });
            side.store.change((draft) => { draft.lookup.byId.b.value.x = 5; });
            side.store.change((draft) => { draft.rows.push(b); });
        });
        side.stop();
        const last = side.next[side.next.length - 1];
        expect(last[1]).toStrictEqual({id: 'b', value: {x: 5}});
        expect(last).toStrictEqual(side.store.getData().rows);
        expect(last[1]).not.toBe(side.previous[0][1]);
    });
});
