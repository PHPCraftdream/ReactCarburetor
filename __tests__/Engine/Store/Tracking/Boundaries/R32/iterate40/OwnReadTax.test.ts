import {rstest} from '@rstest/core';
import {createReadProxy} from '@/Carburetor/Store/Tracking/createReadProxy';
import {ArrayCallbackMethods} from '@/Carburetor/Store/Tracking/Proxy/Positional/ArrayCallbackMethods';

describe('R40-03: own reads bypass callback-method eligibility', () => {
    test('own leaves and indices make no supports calls; inherited map keeps its stable wrapper', () => {
        const reads = new Set<string>();
        const view = createReadProxy({object: {leaf: 17}, array: [17]}, path => reads.add(path));
        const object = view.object;
        const array = view.array;
        const supports = rstest.spyOn(ArrayCallbackMethods, 'supports');
        try {
            let checksum = 0;
            for (let i = 0; i < 1000; i++) {
                checksum += object.leaf;
                checksum += array[0]!;
            }
            const ownCalls = supports.mock.calls.length;
            supports.mockClear();
            const map = array.map;
            const stableMap = array.map;
            const mapCalls = supports.mock.calls.length;

            expect(mapCalls).toBeGreaterThanOrEqual(1);
            expect(map).not.toBe(Array.prototype.map);
            expect(stableMap).toBe(map);
            expect(array.map(value => value + 1)).toEqual([18]);
            expect(checksum).toBe(34_000);
            expect([...reads].sort()).toEqual([
                'array.0', 'array.length', 'array.~p', 'object.leaf', 'object.~p',
            ]);
            expect(ownCalls).toBe(0);
        } finally {
            supports.mockRestore();
        }
    });
});
