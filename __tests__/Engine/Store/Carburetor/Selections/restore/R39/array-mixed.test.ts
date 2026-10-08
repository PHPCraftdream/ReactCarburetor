import {Carburetor, CarburetorHistory} from "@/Carburetor";
import {PATCH_OPAQUE, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {createWriteProxy} from "@/Carburetor/Store/Tracking/createWriteProxy";
import {readsOf} from "../../../fixtures";

interface IRow {id: number; title: string; done: boolean}
interface IData {rows: IRow[]}
type TPatch = Parameters<TPatchRecorder>[0];
const make = (count: number): IRow[] => Array.from({length: count}, (_, id) => ({id, title: 'T' + id, done: false}));

class Store extends Carburetor<IData> {}

// R39-05: movements must not disable the genuine-leaf threshold or corrupt graph replay.
describe('R39-05 mixed and replay mechanisms', () => {
    test.each([0, 5000])('filter history at %s records reversible index patches', at => {
        const store = new Store({rows: make(10_000)});
        const history = new CarburetorHistory(store);
        const before = JSON.stringify(store.getData());
        const patches: TPatch[] = [];
        const detach = store.attachPatchListener({patch: patch => { patches.push(patch); }});
        store.update((draft: IData) => { draft.rows = draft.rows.filter(row => row.id !== at); });
        const after = JSON.stringify(store.getData());
        detach();
        expect(history.undo()).toBe(true);
        expect(JSON.stringify(store.getData())).toBe(before);
        expect(history.redo()).toBe(true);
        expect(JSON.stringify(store.getData())).toBe(after);
        expect(patches.length).toBe(10_000 - at + 1);
        expect(patches.every(patch => typeof patch !== 'symbol' && patch.segments.length === 2)).toBe(true);
    });

    test('10k map replacement remains leaf-precise beside a later movement', () => {
        const store = new Store({rows: make(10_000)});
        const before = store.getData().rows.slice();
        let wakes = 0;
        for (let i = 0; i < 200; i++) store.subscribe(() => wakes++, {reads: readsOf('rows.' + (i * 37) + '.title')});
        const patches: TPatch[] = [];
        store.attachPatchListener({patch: patch => { patches.push(patch); }});
        store.update((draft: IData) => {
            draft.rows = draft.rows.map(row => row.id === 3700 ? {...row, title: 'changed'} : row);
        });
        expect(wakes).toBe(1);
        expect(patches.filter(patch => typeof patch !== 'symbol').map(patch => patch.segments.join('.')))
            .toEqual(['rows.3700.title']);
        store.update((draft: IData) => {
            draft.rows = [draft.rows[9999], ...draft.rows.slice(1, 9999), draft.rows[0]];
        });
        expect(wakes).toBe(2);
        expect(store.getData().rows[3700]).toEqual({...before[3700], title: 'changed'});
        expect(patches.filter(patch => typeof patch !== 'symbol').map(patch => patch.segments.join('.')))
            .toEqual(['rows.3700.title', 'rows.0', 'rows.9999']);
    });

    test.each([2010, 5000])('movement keeps genuine R36 threshold for %s of 5000 replacements', changed => {
        const previous = Array.from({length: 5002}, (_, title) => ({title}));
        const next = previous.map((row, i) => i >= 2 && i < changed + 2 ? {title: -1} : row);
        [next[0], next[1]] = [next[1], next[0]];
        const buffered: TPatch[] = [];
        const immediate: TPatch[] = [];
        const paths = diffPaths(previous, next, 'rows', ['rows'], buffered);
        expect(diffPaths(previous, next, 'rows', ['rows'], patch => { immediate.push(patch); })).toEqual(paths);
        expect(immediate).toEqual(buffered);
        if (changed === 2010) {
            expect(paths.size).toBe(2012);
            expect(paths.has('rows.0')).toBe(true);
            expect(paths.has('rows.2011.title')).toBe(true);
        } else {
            expect(paths).toEqual(new Set(['rows']));
            expect(buffered.length).toBe(1);
        }
    });

    test('sparse shifted occupants record own indices, not fields or holes', () => {
        const rows = make(2);
        const previous: IRow[] = [];
        previous.length = 10_000;
        previous[100] = rows[0];
        previous[101] = rows[1];
        const next = previous.slice();
        [next[100], next[101]] = [next[101], next[100]];
        const patches: TPatch[] = [];
        expect(diffPaths(previous, next, 'rows', ['rows'], patches)).toEqual(new Set(['rows.100', 'rows.101']));
        expect(patches.map(patch => typeof patch === 'symbol' ? patch : patch.segments.join('.')))
            .toEqual(['rows.100', 'rows.101']);
        expect(Object.keys(next)).toEqual(['100', '101']);
    });

    test('duplicate-reference history preserves aliases on undo and redo', () => {
        const a = make(1)[0];
        const b = {...a, id: 1};
        const store = new Store({rows: [a, b, a]});
        const history = new CarburetorHistory(store);
        store.update((draft: IData) => { draft.rows = [draft.rows[1], draft.rows[0], draft.rows[2]]; });
        expect(store.getData().rows[1]).toBe(store.getData().rows[2]);
        expect(history.undo()).toBe(true);
        expect(store.getData().rows[0]).toBe(store.getData().rows[2]);
        expect(store.getData().rows.map(row => row.id)).toEqual([0, 1, 0]);
        expect(history.redo()).toBe(true);
        expect(store.getData().rows[1]).toBe(store.getData().rows[2]);
        expect(store.getData().rows.map(row => row.id)).toEqual([1, 0, 0]);
    });

    test('nested aliases across moved rows request a graph-safe snapshot', () => {
        const shared = {value: 1};
        const a = {id: 0, shared};
        const b = {id: 1, shared};
        const data = {rows: [a, b]};
        const paths = new Set<string>();
        const patches: TPatch[] = [];
        const draft = createWriteProxy(data, path => { paths.add(path); }, '', undefined, undefined,
            {listener: patch => { patches.push(patch); }});
        draft.rows = [draft.rows[1], draft.rows[0]];
        expect(paths).toEqual(new Set(['rows.0', 'rows.1']));
        expect(patches).toEqual([PATCH_OPAQUE]);
        expect(data.rows[0].shared).toBe(data.rows[1].shared);
    });
});
