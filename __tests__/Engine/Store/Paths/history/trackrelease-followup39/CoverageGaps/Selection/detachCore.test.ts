import {detachOpaqueInto} from '@/Carburetor/Store/Utils/Selection/detachCore';

describe('detachCore', () => {
    test('detaches shared graphs and preserves cycle identity', () => {
        const shared: {n: number} = {n: 1};
        const source: {left: object; right: object; self?: unknown} = {left: shared, right: shared};
        source.self = source;
        const seen = new WeakMap<object, unknown>();
        let sharing = 0;
        const copy = detachOpaqueInto(source, seen, undefined, undefined, () => sharing++) as typeof source;
        expect(copy).not.toBe(source);
        expect(copy.left).toBe(copy.right);
        expect(copy.self).toBe(copy);
        expect(sharing).toBeGreaterThan(0);
        expect(seen.get(source)).toBe(copy);
    });

    test('copies sparse arrays without filling holes', () => {
        const input: unknown[] = [];
        input.length = 3;
        input[2] = undefined;
        const copy = detachOpaqueInto(input, new WeakMap()) as unknown[];
        expect(copy).not.toBe(input);
        expect(copy.length).toBe(3);
        expect(0 in copy).toBe(false);
        expect(2 in copy).toBe(true);
    });
});
