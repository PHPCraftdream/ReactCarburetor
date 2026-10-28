import {Carburetor, computed} from '@/Carburetor';
import {captureLeafVersions} from '@/Carburetor/Derived/Freshness/captureLeafVersions';
import {IReadSet} from '@/Carburetor/Derived/Freshness/Models';
import {computedDependencies} from '@/Carburetor/Derived/computedDependencies';

const edge = (source: IReadSet['source']): IReadSet => ({source, reads: new Set(['*'])});

describe('capture freshness gaps', () => {
    test('a matching registered native getter can reuse its cached leaf snapshot', () => {
        const store = new Carburetor({value: 3});
        const inner = computed(read => read(store).value);
        inner.get();
        const metadata = computedDependencies.nativeVersions.get(inner as never)!;
        expect(computedDependencies.versions.get(inner as never)).toBe(metadata.getter);
        expect(captureLeafVersions({inner: edge(inner as never)}).versions)
            .toBe(metadata.getter());
    });

    test('an externally-shaped source without an inner snapshot is captured as its own leaf', () => {
        const external = {getUID: () => 'external-gap', getVersion: () => 4,
            subscribe: () => 'sub', unsubscribe: () => {}} as unknown as IReadSet['source'];
        const captured = captureLeafVersions({external: edge(external)});
        expect(captured.allNative).toBe(false);
        expect(Object.values(captured.versions).map(record => [record.source, record.version]))
            .toEqual([[external, 4]]);
    });

    test('duplicate references to the same inner snapshot contribute leaves once', () => {
        const store = new Carburetor({value: 9});
        const inner = computed(read => read(store).value);
        inner.get();
        const captured = captureLeafVersions({left: edge(inner as never), right: edge(inner as never)});
        expect(Object.keys(captured.versions)).toEqual([':' + store.getUID()]);
        expect(Object.values(captured.versions)[0].version).toBe(store.getVersion());
    });
});
