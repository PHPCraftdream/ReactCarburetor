import {rstest} from '@rstest/core';
import {ArrayIdentity} from '@/Carburetor/Store/Paths/Diff/Kinds/ArrayIdentity';
import {diffPaths} from '@/Carburetor/Store/Paths/Diff/diffPaths';

const isObject = (value: unknown): value is object => value !== null && typeof value === 'object';

// Set-membership definition of "moved" on raw arrays.
const reference = (previous: unknown[], next: unknown[], old: unknown, value: unknown): boolean => {
    if (Object.is(old, value)) return false;
    if (isObject(value) && previous.includes(value)) return true;
    return isObject(old) && value !== undefined && next.includes(old);
};

const random = (seed: number) => () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('R39-05 identity scan agrees with Set membership', () => {
    test('random replacements, moves and length changes, below and above the scan limit', () => {
        const next01 = random(39);
        const pick = (n: number): number => Math.floor(next01() * n);
        let scanned = 0;
        let indexed = 0;
        for (let trial = 0; trial < 600; trial++) {
            const pool = Array.from({length: 14}, (_, id) => ({id}));
            const size = 4 + pick(30);
            const previous: unknown[] = Array.from({length: size}, () => pool[pick(pool.length)]);
            const next = previous.slice();
            const differences = 1 + pick(14);
            for (let step = 0; step < differences; step++) {
                const at = pick(next.length);
                const kind = pick(5);
                next[at] = kind === 0 ? {id: -step} : kind === 1 ? pool[pick(pool.length)] : kind === 2 ? undefined
                    : kind === 3 ? step : previous[pick(previous.length)];
            }
            if (pick(4) === 0) next.length = Math.max(0, next.length - 1 - pick(3));
            if (pick(4) === 0) next.push(pool[pick(pool.length)], {id: 99});
            const identity = new ArrayIdentity(previous, next);
            const limit = Math.max(previous.length, next.length);
            let mismatches = 0;
            for (let index = 0; index < limit; index++) {
                const old = previous[index];
                const value = next[index];
                if (old === value) continue;
                mismatches++;
                expect(identity.moved(old, value)).toBe(reference(previous, next, old, value));
            }
            if (mismatches > 8) indexed++; else scanned++;
        }
        expect(scanned).toBeGreaterThan(100);
        expect(indexed).toBeGreaterThan(100);
    });
});

describe('R39-05 one replaced row in a large array', () => {
    test('allocates no per-row membership', () => {
        const rows = Array.from({length: 5000}, (_, id) => ({id, done: false}));
        const next = rows.map((row, index) => index === 2500 ? {...row, done: true} : row);
        const adds = rstest.spyOn(Set.prototype, 'add');
        try {
            const changed = diffPaths({rows}, {rows: next});
            expect([...changed]).toEqual(['rows.2500.done']);
            // A per-row index would add one entry per row to each of two Sets.
            expect(adds.mock.calls.length).toBeLessThan(50);
        } finally {
            adds.mockRestore();
        }
    });
});
