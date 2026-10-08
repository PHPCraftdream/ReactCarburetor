import {PATCH_OPAQUE, TPatchRecorder} from "@/Carburetor/Models/Paths";
import {createWriteProxy} from "@/Carburetor/Store/Tracking/createWriteProxy";
import {createAliasLedger} from "@/Carburetor/Store/Tracking/Aliases/AliasLedger";
import {diffPaths} from "@/Carburetor/Store/Paths/Diff/diffPaths";
import {types} from "node:util";

interface IRow {id: number; title: string; done: boolean}
type TPatch = Parameters<TPatchRecorder>[0];
const make = (count = 10_000): {rows: IRow[]} => ({
    rows: Array.from({length: count}, (_, id) => ({id, title: 'T' + id, done: id % 2 === 0})),
});

const run = (development: boolean, at: number): {paths: Set<string>; patches: TPatch[]} => {
    const data = make();
    const paths = new Set<string>();
    const patches: TPatch[] = [];
    const draft = createWriteProxy(data, path => { paths.add(path); }, '',
        development ? createAliasLedger() : undefined, undefined,
        {listener: patch => { patches.push(patch); }});
    draft.rows = draft.rows.filter(row => row.id !== at);

    return {paths, patches};
};

describe('R39-05 patch observer and graph boundaries', () => {
    test.each([0, 5000])('development/production proxy onPatch parity at %p', at => {
        const development = run(true, at);
        const production = run(false, at);
        expect(production.paths).toEqual(development.paths);
        expect(production.patches).toEqual(development.patches);
        expect.soft(production.paths.size).toBe(10_000 - at + 2);
        expect.soft(production.patches.length).toBe(10_000 - at + 1);
        expect(production.patches.every(patch => typeof patch !== 'symbol' && patch.segments.length === 2)).toBe(true);
    });

    test('duplicate references are moved occupants, not unrelated replacement rows', () => {
        const a = make(1).rows[0];
        const b = {...a, id: 1, title: 'T1'};
        const data = {rows: [a, b, a]};
        const paths = new Set<string>();
        const patches: TPatch[] = [];
        const draft = createWriteProxy(data, path => { paths.add(path); }, '', undefined, undefined,
            {listener: patch => { patches.push(patch); }});
        draft.rows = [draft.rows[1], draft.rows[0], draft.rows[2]];

        expect(data.rows[0]).toBe(b);
        expect(data.rows[1]).toBe(a);
        expect(data.rows[2]).toBe(a);
        expect(data.rows.every(row => !types.isProxy(row))).toBe(true);
        expect(paths).toEqual(new Set(['rows.0', 'rows.1']));
        expect(patches).toEqual([PATCH_OPAQUE]);
    });

    test('moving an existing cyclic occupant never recursively diffs its fields', () => {
        interface ICyclic {id: number; self?: ICyclic}
        const a: ICyclic = {id: 0};
        const b: ICyclic = {id: 1};
        a.self = a;
        b.self = b;
        const previous = [a, b];
        const next = [b, a];
        const patches: TPatch[] = [];
        const paths = diffPaths(previous, next, 'rows', ['rows'], patches);

        expect(paths).toEqual(new Set(['rows.0', 'rows.1']));
        expect(patches).toEqual([PATCH_OPAQUE]);
        expect(next[0]).toBe(b);
        expect(next[1]).toBe(a);
    });

    test('development still refuses a newly assigned cycle before recording', () => {
        interface ICyclic {id: number; self?: ICyclic}
        const a: ICyclic = {id: 0};
        a.self = a;
        const data: {rows: ICyclic[]} = {rows: [{id: 1}]};
        const paths = new Set<string>();
        const draft = createWriteProxy(data, path => { paths.add(path); }, '', createAliasLedger());

        expect(() => { draft.rows = [a]; }).toThrow('cyclic');
        expect(paths.size).toBe(0);
        expect(data.rows).toEqual([{id: 1}]);
    });
});
