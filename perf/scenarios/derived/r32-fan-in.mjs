/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-02: one outer computed over K inner computeds sharing one store settles in O(K^2 * M)
// before the combined capture read set, linear after. Sizes are hardcoded.
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
class FanStore extends Carburetor {
    bump(i) { this.update(d => { d.rows[i].a++; }); }
}

const sizes = [100, 400, 1600];
const warmup = 2;
const rounds = 9;

const bench = k => {
    const store = new FanStore({rows: Array.from({length: k}, (_, n) => ({a: n, b: n, c: n, d: n, e: n}))});
    const inner = Array.from({length: k}, (_, n) => computed(read => {
        const row = read(store).rows[n];
        return row.a + row.b + row.c + row.d + row.e;
    }));
    let outerRuns = 0;
    const outer = computed(read => {
        outerRuns++;
        return inner.reduce((sum, c) => sum + read(c), 0);
    });
    outer.subscribe(() => {});
    outer.get();
    const samples = [];
    for (let round = 0; round < rounds; round++) {
        global.gc?.();
        const start = performance.now();
        store.bump(k - 1 - round);
        outer.get();
        const ms = performance.now() - start;
        if (round >= warmup) samples.push(ms);
    }
    return {ms: median(samples), runs: outerRuns, value: outer.get()};
};

const r100 = bench(sizes[0]);
const r400 = bench(sizes[1]);
const r1600 = bench(sizes[2]);
emit({
    settle100Ms: r100.ms, settle400Ms: r400.ms, settle1600Ms: r1600.ms,
    outerRuns: r1600.runs, value: r1600.value,
});
