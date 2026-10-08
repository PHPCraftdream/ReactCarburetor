import {Carburetor, CarburetorHistory} from '@/Carburetor';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';
import {requiresArrayGraphRestore} from '@/Carburetor/Store/Paths/Diff/Kinds/requiresArrayGraphRestore';
import {TPatchRecorder} from '@/Carburetor/Models/Paths';

type TPatch = Parameters<TPatchRecorder>[0];

describe('R39-05 review boundaries', () => {
    test('sparse direct diff retains enumerable string keys and their patch values', () => {
        const previous = [] as unknown[] & {label?: string};
        const next = [] as unknown[] & {label?: string};
        previous.length = next.length = 10_000;
        previous.label = 'before';
        next.label = 'after';
        const patches: TPatch[] = [];
        expect(diffPaths(previous, next, 'rows', ['rows'], patches)).toEqual(new Set(['rows.label']));
        expect(patches).toEqual([{segments: ['rows', 'label'], previousExists: true,
            previous: 'before', nextExists: true, next: 'after'}]);
    });

    test('permutation history keeps unrelated sibling identity and repeated occupants', () => {
        const a = {id: 0};
        const b = {id: 1};
        const store = new Carburetor({rows: [a, b, a], untouched: {value: 42}});
        const untouched = store.getData().untouched;
        const history = new CarburetorHistory(store);
        store.update(draft => { draft.rows = [draft.rows[1], draft.rows[0], draft.rows[2]]; });
        history.undo();
        expect.soft(store.getData().untouched).toBe(untouched);
        expect(store.getData().rows[0]).toBe(store.getData().rows[2]);
        history.redo();
        expect(store.getData().untouched).toBe(untouched);
        expect(store.getData().rows[1]).toBe(store.getData().rows[2]);
    });

    test('history retains aliases between moved rows and an unchanged root sibling', () => {
        const shared = {value: 42};
        const a = {id: 0, shared};
        const b = {id: 1, shared};
        const store = new Carburetor({rows: [a, b, a], shared});
        const original = store.getData().shared;
        const history = new CarburetorHistory(store);
        store.update(draft => { draft.rows = [draft.rows[1], draft.rows[0], draft.rows[2]]; });
        for (const replay of [() => history.undo(), () => history.redo()]) {
            expect(replay()).toBe(true);
            const data = store.getData();
            expect(data.shared).toBe(original);
            expect(data.rows.every(row => row.shared === data.shared)).toBe(true);
        }
    });

    test('graph restore classifier terminates on distinct cyclic plain branches', () => {
        interface INode {value: number; self?: INode}
        const previous: INode = {value: 0};
        const next: INode = {value: 1};
        previous.self = previous;
        next.self = next;
        expect(requiresArrayGraphRestore(previous, next)).toBe(false);
    });
});
