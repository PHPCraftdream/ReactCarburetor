import {Carburetor} from '@/Carburetor';
import {sameSelection} from '@/Carburetor/Component/Connection/sameSelection';
import {detachOpaque} from '@/Carburetor/Store/Utils/Selection/detachOpaque';

interface INativeData {
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    map: Map<string, number>;
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    set: Set<string>;
}

interface INativeSelection {
    map: ReadonlyMap<string, number>;
    set: ReadonlySet<string>;
}

interface IAliasRow {
    value: number;
}

interface IAliasData {
    sharedMaps: boolean;
    sharedRow: boolean;
    revision: number;
    row: IAliasRow;
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    firstMap: Map<string, IAliasRow>;
    // oxlint-disable-next-line carburetor/no-untrackable-store-data
    secondMap: Map<string, IAliasRow>;
}

const makeAliasData = (
    sharedMaps: boolean,
    sharedRow: boolean,
    value: number,
    revision: number
): IAliasData => {
    const row = {value};
    const firstMap = new Map<string, IAliasRow>([['row', sharedRow ? row : {value}]]);
    const secondMap = sharedMaps
        ? firstMap
        : new Map<string, IAliasRow>([['row', sharedRow ? row : {value}]]);

    return {sharedMaps, sharedRow, revision, row, firstMap, secondMap};
};

const makeNativeData = (
    entries: Array<[string, number]> = [['a', 1], ['b', 2]],
    members: string[] = ['x', 'y']
): INativeData => ({map: new Map(entries), set: new Set(members)});

const describeNative = (selection: INativeSelection): string =>
    Array.from(selection.map, ([key, value]) => `${key}:${value}`).join(',') + '|' +
    Array.from(selection.set).join(',');

describe('watch preserves ordered Map and Set selection snapshots (R31-01)', () => {
    test('same order suppresses; both reorder directions and changed content are delivered', () => {
        const store = new Carburetor<INativeData>(makeNativeData());
        const seen: string[] = [];
        const stop = store.watch(data => ({map: data.map, set: data.set}), next => {
            seen.push(describeNative(next));
        });

        store.setData(makeNativeData());
        expect(seen).toEqual([]);

        store.setData(makeNativeData([['b', 2], ['a', 1]], ['y', 'x']));
        expect(seen).toEqual(['b:2,a:1|y,x']);

        store.setData(makeNativeData());
        expect(seen).toEqual(['b:2,a:1|y,x', 'a:1,b:2|x,y']);

        store.setData(makeNativeData([['a', 7], ['b', 2]], ['x', 'y']));
        expect(seen[seen.length - 1]).toBe('a:7,b:2|x,y');

        store.setData(makeNativeData([['a', 7], ['b', 2]], ['x', 'z']));
        expect(seen[seen.length - 1]).toBe('a:7,b:2|x,z');
        expect(seen).toHaveLength(4);

        stop();
    });

    test('NaN Map keys compare by native identity and recursive values preserve cycles', () => {
        interface ICyclicMapData {
            // oxlint-disable-next-line carburetor/no-untrackable-store-data
            map: Map<unknown, unknown>;
        }

        const withCycle = (value: number): ICyclicMapData => {
            const map = new Map<unknown, unknown>();
            map.set(Number.NaN, map);
            map.set('value', {value});

            return {map};
        };
        const store = new Carburetor<ICyclicMapData>(withCycle(1));
        const seen: Array<{self: boolean; value: number}> = [];
        const stop = store.watch(data => data.map, next => {
            const member = next.get('value');
            const value = member !== null && typeof member === 'object' && 'value' in member &&
                typeof member.value === 'number' ? member.value : Number.NaN;

            seen.push({self: next.get(Number.NaN) === next, value});
        });

        store.setData(withCycle(1));
        expect(seen).toEqual([]);

        store.setData(withCycle(2));
        expect(seen).toEqual([{self: true, value: 2}]);

        stop();
    });

    test('NaN Set members compare by native SameValueZero semantics', () => {
        interface INaNSetData {
            // oxlint-disable-next-line carburetor/no-untrackable-store-data
            members: Set<number>;
        }

        const store = new Carburetor<INaNSetData>({members: new Set([Number.NaN])});
        const seen: number[][] = [];
        const stop = store.watch(data => data.members, next => { seen.push(Array.from(next)); });

        store.setData({members: new Set([Number.NaN])});
        expect(seen).toEqual([]);

        store.setData({members: new Set([Number.NaN, 1])});
        expect(seen).toHaveLength(1);
        expect(Number.isNaN(seen[0][0])).toBe(true);
        expect(seen[0][1]).toBe(1);

        stop();
    });

    test('shared native references and plain/native value bridges keep selection topology', () => {
        const store = new Carburetor<IAliasData>(makeAliasData(true, true, 1, 0));
        const seen: Array<{
            sameMap: boolean;
            sameRow: boolean;
            rowValue: number;
            mapValue: number | undefined;
            parity: number;
        }> = [];
        const stop = store.watch(data => ({
            first: data.sharedMaps ? data.firstMap : data.secondMap,
            second: data.firstMap,
            row: data.row,
            parity: data.revision % 2,
        }), next => {
            const mapRow = next.second.get('row');

            seen.push({
                sameMap: next.first === next.second,
                sameRow: next.row === mapRow,
                rowValue: next.row.value,
                mapValue: mapRow?.value,
                parity: next.parity,
            });
        });

        store.setData(makeAliasData(true, true, 1, 2));
        expect(seen).toEqual([]);

        store.setData(makeAliasData(false, true, 1, 4));
        expect(seen).toEqual([{sameMap: false, sameRow: true, rowValue: 1, mapValue: 1, parity: 0}]);

        store.setData(makeAliasData(true, false, 1, 6));
        expect(seen[1]).toEqual({sameMap: true, sameRow: false, rowValue: 1, mapValue: 1, parity: 0});

        store.setData(makeAliasData(true, false, 2, 8));
        expect(seen[2]).toEqual({sameMap: true, sameRow: false, rowValue: 2, mapValue: 2, parity: 0});

        store.setData(makeAliasData(true, true, 2, 10));
        expect(seen[3]).toEqual({sameMap: true, sameRow: true, rowValue: 2, mapValue: 2, parity: 0});

        stop();
    });

    test('alias topology comparison continues reading through live plain branches', () => {
        const store = new Carburetor<IAliasData>(makeAliasData(true, true, 1, 0));
        const reads = new Set<string>();
        const view = store.read(path => { reads.add(path); });
        const repeatedSnapshot = detachOpaque({first: view.firstMap, second: view.firstMap});
        const repeatedFresh = {first: view.firstMap, second: view.firstMap};

        expect(sameSelection(repeatedSnapshot, repeatedFresh)).toBe(true);

        const snapshot = detachOpaque({row: view.row, map: view.firstMap});
        const fresh = {row: view.row, map: view.firstMap};

        reads.clear();

        expect(sameSelection(snapshot, fresh)).toBe(true);
        expect(reads.has('row.value')).toBe(true);
    });

});
