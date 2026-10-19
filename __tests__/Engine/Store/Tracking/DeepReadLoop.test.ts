import {Carburetor} from '@/Carburetor';

interface IDeepData {
    a: {ka: number; b: {kb: number; c: {kc: number; d: Record<string, number>}}};
}

const LOOP_COUNT = 20000;
const WALL_CLOCK_BOUND_MS = 10000;

const getDeepData = (): IDeepData => {
    const leaves: Record<string, number> = {};
    for (let i = 0; i < 64; i++) leaves[`l${i}`] = i;

    return {a: {ka: 1, b: {kb: 2, c: {kc: 3, d: {...leaves, kd: 4}}}}};
};

describe('deep read loop', () => {
    // Regression: each read that touched a nested branch used to grow tracker bookkeeping that
    // was rescanned on every later branch construction, so the per-read cost rose with the
    // iteration count. Reads must stay flat: LOOP_COUNT iterations finish well inside the bound.
    it('keeps nested reads at constant cost across many iterations', () => {
        const store = new Carburetor<IDeepData>(getDeepData());
        let sink = 0;

        const start = performance.now();
        for (let i = 0; i < LOOP_COUNT; i++) {
            const reads = new Set<unknown>();
            const proxy = store.read((p) => reads.add(p));
            sink += proxy.a.ka;
        }
        const elapsed = performance.now() - start;

        expect(sink).toBe(LOOP_COUNT);
        expect(elapsed).toBeLessThan(WALL_CLOCK_BOUND_MS);
    });
});
