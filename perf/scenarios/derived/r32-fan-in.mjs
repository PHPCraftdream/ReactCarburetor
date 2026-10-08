/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-02: one outer computed over K inner computeds sharing one store settles in O(K^2 * M)
// before the combined capture read set, linear after. Sizes are hardcoded.
import {emit, load, median} from '../../harness/lib.mjs';
import {countSets} from './pg-b1/set-work.mjs';

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
    const runs = outerRuns;
    const value = outer.get();
    const work = countSets(() => { store.bump(0); return outer.get(); });
    return {ms: median(samples), runs, value, work};
};

const r100 = bench(sizes[0]);
const r400 = bench(sizes[1]);
const r1600 = bench(sizes[2]);
const empty = countSets(() => 0);
const control = countSets(() => new Set([1, 2, 3]));
emit({
    setConstructions100: r100.work.constructions, setAdds100: r100.work.adds, setWork100: r100.work.work,
    setConstructions1600: r1600.work.constructions, setAdds1600: r1600.work.adds, setWork1600: r1600.work.work,
    emptySetWork: empty.work, controlSetConstructions: control.constructions, controlSetAdds: control.adds,
    controlFanInWork100: r100.work.work, fanInValue100: r100.work.value, fanInValue1600: r1600.work.value,
    settle100Ms: r100.ms, settle400Ms: r400.ms, settle1600Ms: r1600.ms,
    outerRuns: r1600.runs, value: r1600.value,
});
