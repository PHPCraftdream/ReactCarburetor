import {reconcileSelection} from '@/Carburetor/Store/Utils/Selection/reconcileSelection';

interface IRaw {
    id: number;
    title: string;
    tags: {a: number};
}

/**
 * Deterministic linear-congruential PRNG.
 *
 * @param seed - the starting seed
 * @returns a zero-argument function producing the next pseudo-random number in [0, 1)
 */
const createRng = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return (): number => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
};

describe('reconcileSelection with a previous ledger under moves (R36-06 differential fuzz)', () => {
    test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: equals a full copy, keeps every unchanged moved row', (seed) => {
        const rng = createRng(seed * 7919);
        let nextId = 0;
        const makeRow = (): IRaw => ({id: nextId, title: `r${nextId++}`, tags: {a: nextId}});
        let live: IRaw[] = Array.from({length: 30}, makeRow);
        let ledger = new WeakMap<object, unknown>();
        let snapshot = reconcileSelection<IRaw[]>([], live, undefined, undefined, undefined, ledger);

        for (let step = 0; step < 300; step++) {
            const next = [...live];
            const op = rng();
            const at = Math.floor(rng() * Math.max(next.length, 1));
            if (op < 0.2) next.unshift(makeRow());
            else if (op < 0.3) next.splice(at, 0, makeRow());
            else if (op < 0.45) next.splice(at, 1);
            else if (op < 0.65) next.splice(Math.floor(rng() * next.length), 0, ...next.splice(at, 1));
            else if (op < 0.8) {
                const other = Math.floor(rng() * next.length);
                [next[at], next[other]] = [next[other], next[at]];
            } else if (next.length > 0) next[at] = {...next[at], title: `e${step}`};
            live = next;

            const nextLedger = new WeakMap<object, unknown>();
            const previous = snapshot;
            const previousLedger = ledger;
            snapshot = reconcileSelection<IRaw[]>(previous, live, undefined, undefined, previousLedger, nextLedger);
            ledger = nextLedger;

            expect(snapshot).toEqual(JSON.parse(JSON.stringify(live)));
            expect(snapshot).toHaveLength(live.length);
            const priorCopies = new Set<unknown>(previous);
            for (let index = 0; index < live.length; index++) {
                const prior = previousLedger.get(live[index]) as IRaw | undefined;
                if (prior !== undefined && JSON.stringify(prior) === JSON.stringify(live[index])) {
                    expect(snapshot[index]).toBe(prior);
                    expect(priorCopies.has(prior)).toBe(true);
                }
            }
            expect(new Set(snapshot).size).toBe(snapshot.length);
        }
    });
});
