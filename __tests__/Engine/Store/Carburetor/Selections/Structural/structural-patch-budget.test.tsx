import * as React from 'react';
import {act} from 'react';
import {render} from '@testing-library/react';
import {Carburetor} from '@/Carburetor';
import {useCarburetorValue} from '@/Interop';

interface IRow {id: number; value: {n: number};}
interface IData {rows: IRow[]; dictionary: Record<string, IRow>; other: number;}
const COUNT = 10000;

/** Counts the paths a selection walk records below the selected container. */
class CountingStore extends Carburetor<IData> {
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

    /** Paths recorded under members of `root`, since the last reset.
     *
     * @param root - the selected container's key
     * @returns member-level and deeper paths
     */
    public memberReads(root: string): string[] {
        const prefix = new RegExp('^' + root + '\\.[^.]+\\.');
        return this.recordedPaths.filter((path) => prefix.test(path));
    }
}

const makeStore = (): CountingStore => {
    const rows = Array.from({length: COUNT}, (_, id) => ({id, value: {n: id}}));
    return new CountingStore({rows, dictionary: Object.fromEntries(rows.map((row) => [String(row.id), {
        id: row.id, value: {n: row.value.n},
    }])), other: 0});
};

/** Counts members of `next` that are not the previous snapshot's copies.
 *
 * @param previous - the earlier snapshot
 * @param next - the later snapshot
 * @returns how many member copies are new
 */
const freshMembers = (previous: object, next: object): number => {
    const known = new Set<unknown>(Object.values(previous));
    return Object.values(next).filter((member) => !known.has(member)).length;
};

describe('structural selection changes patch the selected container only', () => {
    test('append reuses every row copy and reads only the new row', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { seen.push(next); });
        store.change((draft) => { draft.rows[0].value.n = -1; });
        store.recordedPaths = [];
        store.change((draft) => { draft.rows.push({id: COUNT, value: {n: COUNT}}); });
        expect(store.memberReads('rows').length).toBeLessThanOrEqual(6);
        expect(seen).toHaveLength(2);
        expect(seen[1]).not.toBe(seen[0]);
        expect(freshMembers(seen[0], seen[1])).toBe(1);
        expect(seen[1]).toStrictEqual(store.getData().rows);
        stop();
    });

    test('truncation drops the tail and reuses the prefix without reading it', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { seen.push(next); });
        store.change((draft) => { draft.rows[0].value.n = -1; });
        store.recordedPaths = [];
        store.change((draft) => { draft.rows.length = COUNT - 100; });
        expect(store.memberReads('rows')).toHaveLength(0);
        expect(seen[1]).toHaveLength(COUNT - 100);
        expect(freshMembers(seen[0], seen[1])).toBe(0);
        expect(seen[1]).toStrictEqual(store.getData().rows);
        stop();
    });

    test.each([
        ['a sparse append', (draft: IData): void => { draft.rows[COUNT + 2] = {id: COUNT, value: {n: COUNT}}; }],
        ['a length growth', (draft: IData): void => { draft.rows.length = COUNT + 3; }],
    ])('%s leaves holes whose later fill still wakes the watch', (_name, grow) => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { seen.push(next); });
        store.recordedPaths = [];
        store.change(grow);
        expect(store.memberReads('rows').length).toBeLessThanOrEqual(6);
        expect(seen[0]).toStrictEqual(store.getData().rows);
        store.change((draft) => { draft.rows[COUNT] = {id: -1, value: {n: -1}}; });
        expect(seen).toHaveLength(2);
        expect(seen[1]).toStrictEqual(store.getData().rows);
        stop();
    });

    test('a popped row pushed back is not mistaken for a new one', () => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { seen.push(next); });
        const last = store.getData().rows[COUNT - 1];
        store.change((draft) => { draft.rows.pop(); });
        store.change((draft) => { draft.rows.push(last); });
        store.change((draft) => { draft.rows[COUNT - 1].value.n = -1; });
        expect(seen).toHaveLength(3);
        expect(seen[2][COUNT - 1].value.n).toBe(-1);
        expect(seen[2]).toStrictEqual(store.getData().rows);
        stop();
    });

    test('dictionary insertion and deletion reuse every untouched entry', () => {
        const store = makeStore();
        const seen: Array<Record<string, IRow>> = [];
        const stop = store.watch((data: IData) => data.dictionary, (next) => { seen.push(next); });
        store.change((draft) => { draft.dictionary['0'].value.n = -1; });
        store.recordedPaths = [];
        store.change((draft) => {
            delete draft.dictionary['5'];
            draft.dictionary.added = {id: COUNT, value: {n: COUNT}};
        });
        expect(store.memberReads('dictionary').length).toBeLessThanOrEqual(6);
        expect(freshMembers(seen[0], seen[1])).toBe(1);
        expect(Object.keys(seen[1])).toEqual(Object.keys(store.getData().dictionary));
        expect(seen[1]).toStrictEqual(store.getData().dictionary);
        stop();
    });

    test('a key deleted and added again in one batch delivers its new entry', () => {
        const store = makeStore();
        const seen: Array<Record<string, IRow>> = [];
        const stop = store.watch((data: IData) => data.dictionary, (next) => { seen.push(next); });
        store.change((draft) => {
            delete draft.dictionary['7'];
            draft.dictionary['7'] = {id: -7, value: {n: -7}};
        });
        expect(seen).toHaveLength(1);
        expect(seen[0]['7'].id).toBe(-7);
        expect(Object.keys(seen[0])).toEqual(Object.keys(store.getData().dictionary));
        stop();
    });

    test('a new row linking an existing row shares its copy as the full walk does', () => {
        type TLinked = IRow & {back?: {n: number}};
        const store = makeStore();
        const seen: TLinked[][] = [];
        const originalError = console.error;
        let stop: (() => void) | undefined;
        try {
            // The link is a path alias, which development reports.
            console.error = () => undefined;
            stop = store.watch((data: IData) => data.rows as TLinked[], (next) => { seen.push(next); });
            store.change((draft) => {
                const linked: TLinked = {id: COUNT, value: {n: COUNT}};
                linked.back = draft.rows[0].value;
                draft.rows.push(linked);
            });
            store.change((draft) => { draft.rows[0].value.n = -1; });
        } finally {
            console.error = originalError;
            stop?.();
        }
        expect(seen[0][COUNT].back).toBe(seen[0][0].value);
        expect(seen[1][COUNT].back?.n).toBe(-1);
        expect(seen[1][0].value.n).toBe(-1);
    });

    test.each([
        ['append with an in-row write', (draft: IData): void => {
            draft.rows[COUNT - 1].value.n = -1;
            draft.rows.push({id: COUNT, value: {n: COUNT}});
        }],
        ['unshift', (draft: IData): void => { draft.rows.unshift({id: -1, value: {n: -1}}); }],
    ])('%s still takes the full walk (positive control)', (_name, edit) => {
        const store = makeStore();
        const seen: IRow[][] = [];
        const stop = store.watch((data: IData) => data.rows, (next) => { seen.push(next); });
        store.recordedPaths = [];
        const originalError = console.error;
        try {
            // Moved rows warn about path aliasing in development; only the walk is asserted.
            console.error = () => undefined;
            store.change(edit);
        } finally {
            console.error = originalError;
        }
        expect(store.memberReads('rows').length).toBeGreaterThan(COUNT);
        expect(seen[0]).toStrictEqual(store.getData().rows);
        stop();
    });

    test('a hook selecting the list patches an append from the write log', () => {
        const store = makeStore();
        let latest: readonly IRow[] = [];
        const List = (): React.ReactElement => {
            const rows = useCarburetorValue(store, (data: IData) => data.rows);
            // Test instrumentation, not render state.
            // oxlint-disable-next-line react/immutability, react/globals
            latest = rows;
            return <p>{rows.length}</p>;
        };
        const {unmount} = render(<List />);
        const before = latest;
        store.recordedPaths = [];
        act(() => { store.change((draft) => { draft.rows.push({id: COUNT, value: {n: COUNT}}); }); });
        expect(store.memberReads('rows').length).toBeLessThanOrEqual(6);
        expect(freshMembers(before, latest)).toBe(1);
        expect(latest).toStrictEqual(store.getData().rows);
        unmount();
    });
});
