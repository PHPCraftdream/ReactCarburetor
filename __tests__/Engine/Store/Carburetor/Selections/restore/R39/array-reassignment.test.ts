import {Carburetor, CarburetorHistory} from "@/Carburetor";
import {TPath, TPathSet, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {CARBURETOR_NOTIFY_WRITES} from "@/Carburetor/Store/Utils/Models";
import {readsOf} from "../../../fixtures";
import {types} from "node:util";

interface IRow {id: number; title: string; done: boolean}
interface IData {rows: IRow[]}
type TPatch = Parameters<TPatchRecorder>[0];
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const makeRow = (id: number): IRow => ({id, title: 'T' + id, done: id % 2 === 0});
const make = (count = 10_000): IData => ({rows: Array.from({length: count}, (_, id) => makeRow(id))});

class Store extends Carburetor<IData> {
    public lastWrites: TPath[] = [];

    /** Captures exact publication paths. */
    public override [CARBURETOR_NOTIFY_WRITES](writes: TPathSet): void {
        this.lastWrites = [...writes];
        super[CARBURETOR_NOTIFY_WRITES](writes);
    }
}

const sample = (store: Store): number[] => {
    const wakes = Array.from({length: 200}, () => 0);
    wakes.forEach((_, i) => store.subscribe(() => wakes[i]++, {
        reads: readsOf('rows.' + (i * 37 % 10_000) + '.title'),
    }));

    return wakes;
};

const removalPaths = (at: number): string[] => [
    ...Array.from({length: 10_000 - at}, (_, i) => 'rows.' + (at + i)),
    'rows.length', 'rows.~k',
];

const operations: [string, (draft: IData) => void][] = [
    ['prepend', draft => { draft.rows = [makeRow(-1), ...draft.rows]; }],
    ['slice', draft => { draft.rows = draft.rows.slice(1); }],
    ['move', draft => { draft.rows = [...draft.rows.slice(1), draft.rows[0]]; }],
    ['swap', draft => {
        const rows = draft.rows.slice();
        [rows[1], rows[3]] = [rows[3], rows[1]];
        draft.rows = rows;
    }],
];

const expectedPaths = (name: string): string[] => name === 'swap'
    ? ['rows.1', 'rows.3']
    : name === 'move' ? ['rows.0', 'rows.1', 'rows.2', 'rows.3', 'rows.4']
        : [...Array.from({length: name === 'prepend' ? 6 : 5}, (_, i) => 'rows.' + i),
            'rows.length', 'rows.~k'];

// R39-05: positional reassignment must not turn moved occupants into leaf edits.
describe('R39-05 identity-aware array reassignment', () => {
    test.each([0, 5000])('filter at %p has exact splice paths and wakes', at => {
        const filtered = new Store(make());
        const spliced = new Store(make());
        const before = filtered.getData().rows.slice();
        const filterWakes = sample(filtered);
        const spliceWakes = sample(spliced);
        filtered.update((draft: IData) => { draft.rows = draft.rows.filter(row => row.id !== at); });
        spliced.update((draft: IData) => { draft.rows.splice(at, 1); });
        const expected = before.filter(row => row.id !== at);
        const actual = filtered.getData().rows;

        expect(actual).toEqual(spliced.getData().rows);
        expect(actual).toEqual(expected);
        expect(actual.every((row, index) => row === expected[index] && !types.isProxy(row))).toBe(true);
        expect(before[at]).toEqual(makeRow(at));
        expect.soft(filtered.lastWrites.length).toBe(at === 0 ? 10002 : 5002);
        expect.soft(new Set(filtered.lastWrites)).toEqual(new Set(removalPaths(at)));
        expect.soft(new Set(filtered.lastWrites)).toEqual(new Set(spliced.lastWrites));
        expect.soft(filterWakes.reduce((sum, count) => sum + count, 0)).toBe(at === 0 ? 200 : 64);
        expect(filterWakes).toEqual(spliceWakes);
    });

    test.each(operations)('%p preserves occupant identity and records indices', (name, op) => {
        const store = new Store(make(5));
        const before = store.getData().rows.slice();
        const reference = {rows: before.slice()};
        op(reference);
        store.update(op);
        const actual = store.getData().rows;

        expect(actual).toEqual(reference.rows);
        expect(actual.every((row, index) => row.id === -1 || row === reference.rows[index])).toBe(true);
        expect(actual.every(row => !types.isProxy(row))).toBe(true);
        expect(new Set(store.lastWrites)).toEqual(new Set(expectedPaths(name)));
    });

    test('map replacement stays leaf-precise beside a moved occupant', () => {
        const store = new Store(make(5));
        const before = store.getData().rows.slice();
        let titleWakes = 0;
        let doneWakes = 0;
        const titleId = store.subscribe(() => titleWakes++, {reads: readsOf('rows.2.title')});
        const doneId = store.subscribe(() => doneWakes++, {reads: readsOf('rows.2.done')});
        store.update((draft: IData) => {
            draft.rows = draft.rows.map(row => row.id === 2 ? {...row, done: !row.done} : row);
            draft.rows = [draft.rows[1], draft.rows[0], ...draft.rows.slice(2)];
        });

        expect(store.getData().rows[2]).toEqual({...before[2], done: !before[2].done});
        expect(store.getData().rows[2]).not.toBe(before[2]);
        expect(titleWakes).toBe(0);
        expect(doneWakes).toBe(1);
        expect(new Set(store.lastWrites)).toEqual(new Set(['rows.2.done', 'rows.0', 'rows.1']));
        store.unsubscribe(titleId);
        store.unsubscribe(doneId);
    });

    test.each(operations)('%p history uses index patches and round-trips', (name, op) => {
        const store = new Store(make(5));
        const history = new CarburetorHistory<IData>(store);
        const patches: TPatch[] = [];
        const detach = store.attachPatchListener({patch: patch => { patches.push(patch); }});
        const before = JSON.stringify(store.getData());
        store.update(op);
        const after = JSON.stringify(store.getData());
        detach();
        history.undo();
        expect(JSON.stringify(store.getData())).toBe(before);
        history.redo();
        expect(JSON.stringify(store.getData())).toBe(after);
        expect(patches.every(patch => typeof patch !== 'symbol' && patch.segments.length === 2)).toBe(true);
        expect(patches.filter(patch => typeof patch !== 'symbol').map(patch => patch.segments.join('.')).sort(compare))
            .toEqual(expectedPaths(name).filter(path => path !== 'rows.~k').sort(compare));
    });
});
