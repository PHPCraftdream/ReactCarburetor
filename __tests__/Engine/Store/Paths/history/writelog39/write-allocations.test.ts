import {Carburetor} from '@/Carburetor';

class ScalarStore extends Carburetor<{n: number; rows: Array<{a: number}>}> {
    public write(n: number, nested: boolean): void {
        this.update(d => { if (nested) d.rows[0].a = n; else d.n = n; });
    }
}

describe('writes without a selection consumer (R39-04)', () => {
    test.each([false, true])('1000 writes, nested=%s: at most three Maps and 2000 Sets', nested => {
        const store = new ScalarStore({n: 0, rows: [{a: 0}]});
        store.write(1, nested);
        const OriginalMap = globalThis.Map;
        const OriginalSet = globalThis.Set;
        const counts = {maps: 0, sets: 0};
        globalThis.Map = class extends OriginalMap {
            constructor(entries?: Iterable<readonly [unknown, unknown]> | null) {
                super(entries);
                counts.maps++;
            }
        } as MapConstructor;
        globalThis.Set = class extends OriginalSet {
            constructor(values?: Iterable<unknown> | null) {
                super(values);
                counts.sets++;
            }
        } as SetConstructor;
        try {
            for (let n = 2; n <= 1001; n++) store.write(n, nested);
        } finally {
            globalThis.Map = OriginalMap;
            globalThis.Set = OriginalSet;
        }
        expect(store.getVersion()).toBe(1001);
        expect(nested ? store.getData().rows[0].a : store.getData().n).toBe(1001);
        // R39-04: the ordinary publication Sets prove that the constructor probe is active.
        expect(counts.sets).toBeGreaterThanOrEqual(1000);
        console.info('R39-04 constructors per 1000 writes:', counts);
        expect(counts.maps).toBeLessThanOrEqual(3);
        expect(counts.sets).toBeLessThanOrEqual(2000);
    });
});
