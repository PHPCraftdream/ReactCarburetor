import {rstest} from '@rstest/core';
import {completeReads} from '@/Carburetor/Store/Tracking/Observation/completeReads';

describe('R40-02 completion work', () => {
    test('10000 paths use bounded prefix operations, not marker-by-path scans', () => {
        const reads = new Set<string>();
        for (let i = 0; i < 5000; i++) {
            reads.add(`items.r${i}.~p`);
            reads.add(`items.r${i}.title`);
        }
        const ends = rstest.spyOn(String.prototype, 'endsWith');
        const starts = rstest.spyOn(String.prototype, 'startsWith');
        const cuts = rstest.spyOn(String.prototype, 'lastIndexOf');
        const slices = rstest.spyOn(String.prototype, 'slice');
        let operations = 0;
        try {
            expect(completeReads(reads)).toBe(reads);
            operations = ends.mock.calls.length + starts.mock.calls.length
                + cuts.mock.calls.length + slices.mock.calls.length;
        } finally {
            ends.mockRestore();
            starts.mockRestore();
            cuts.mockRestore();
            slices.mockRestore();
        }
        expect(reads.size).toBe(5000);
        expect(operations).toBeGreaterThanOrEqual(10000);
        expect(operations).toBeLessThanOrEqual(100000);
    });

    test('strict prefixes preserve marker-only branches, keys and escaped sibling keys', () => {
        const reads = new Set([
            'a.~p', 'a.b.~p', 'a.b.c.~p', 'alone.~p',
            'keys.~p', 'keys.~k', 'a~1b.~p', 'a~1b.c', 'a~0p.~p', 'a~0p.c',
        ]);
        expect(new Set(completeReads(reads))).toEqual(new Set([
            'a.b.c.~p', 'alone.~p', 'keys.~k', 'a~1b.c', 'a~0p.c',
        ]));
    });
});
