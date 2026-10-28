import {Carburetor} from '@/Carburetor';
import {leafVersionsDrifted} from '@/Carburetor/Derived/Freshness/leafVersionsDrifted';
import type {ILeafVersion, IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {CARBURETOR_HAS_DRIFT} from '@/Carburetor/Store/Utils/Models';

const source = (probe?: (baseline: number, reads: ReadonlySet<string>) => boolean) => {
    const store = new Carburetor({value: 0});
    if (probe !== undefined) store[CARBURETOR_HAS_DRIFT] = probe;
    store.setData({value: 1});
    if (probe === undefined) {
        Object.defineProperty(store, CARBURETOR_HAS_DRIFT, {value: undefined});
    }
    return store;
};

describe('leaf freshness drift gaps', () => {
    test('a native leaf without a drift protocol is conservatively stale', () => {
        const leaf = source() as unknown as ILeafVersion['source'];
        const versions = {leaf: {source: leaf, version: 0, reads: new Set(['value'])}};
        expect(leafVersionsDrifted(versions, {}, false)).toBe(true);
    });

    test('own entries are checked and an inherited snapshot entry is ignored', () => {
        const readSet = new Set<string>(['value']);
        const leaf = source(() => true) as unknown as ILeafVersion['source'];
        const currentVersion = leaf.getVersion();
        const versions = Object.assign(Object.create({
            inherited: {source: leaf, version: 0, reads: readSet},
        }), {
            own: {source: leaf, version: currentVersion, reads: readSet},
        });
        expect(leafVersionsDrifted(versions, {}, false)).toBe(false);
    });

    test('each merged part must remain drift-free', () => {
        const answers: boolean[] = [];
        const leaf = source((_version, reads) => {
            const result = reads.has('first');
            answers.push(result);
            return result;
        }) as unknown as ILeafVersion['source'];
        const versions = {leaf: {source: leaf, version: 0, parts: [
            {version: 0, reads: new Set(['first'])}, {version: 1, reads: new Set(['second'])},
        ]}};
        expect(leafVersionsDrifted(versions, {}, false)).toBe(true);
        expect(answers).toEqual([true]);
    });

    test('direct dependency reads provide the fallback when a leaf has no filed reads', () => {
        const calls: ReadonlySet<string>[] = [];
        const leaf = source((_version, reads) => {
            calls.push(reads);
            return false;
        }) as unknown as IReadSet['source'];
        const reads = new Set<string>(['fallback']);
        const versions = {key: {source: leaf, version: 0} as ILeafVersion};
        const dependencies = {key: {source: leaf, reads} as IReadSet};
        expect(leafVersionsDrifted(versions, dependencies, false)).toBe(false);
        expect(calls).toEqual([reads]);
    });
});
