import {measureDiff} from "@/Carburetor/Store/Paths/Diff/Threshold/measureDiff";

describe('measureDiff', () => {
    test('measures changed leaves, total leaves, and top-level wake keys', () => {
        const wake: string[] = [];
        expect(measureDiff({a: {x: 1}, b: 2}, {a: {x: 3}, b: 2, c: 4}, wake)).toEqual({changed: 2, total: 3});
        expect(wake).toEqual(['a', 'c']);
    });
});
