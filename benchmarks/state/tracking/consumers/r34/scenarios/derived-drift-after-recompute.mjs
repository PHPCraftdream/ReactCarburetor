/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-01: `get()` on an observed computed after an unrelated write, before and after one
// recompute that keeps the same read set. Args: [rows=10000] [samples=200]
import {countWriteLogMatches, emit, load, median} from '../harness/lib.mjs';

const {Carburetor, computed} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 200);
const s = new S({draft: '', items: Array.from({length: rows}, (_, id) => ({id, done: id % 3 === 0}))});
const open = computed(read => {
    let count = 0;
    for (const item of read(s).items) if (!item.done) count++;
    return count;
});
open.subscribe(() => {});
open.get();
const matches = countWriteLogMatches(s);

const phase = label => {
    global.gc?.();
    matches.calls = 0;
    const times = [];
    for (let i = 0; i < samples; i++) {
        s.run(d => { d.draft = label + i; });
        const start = performance.now();
        open.get();
        times.push(performance.now() - start);
    }
    return {ms: median(times), calls: matches.calls};
};

const before = phase('before');
s.run(d => { d.items[4].done = !d.items[4].done; });
const value = open.get();
const after = phase('after');
emit({
    getBeforeRecomputeMs: before.ms, writeLogMatchesBefore: before.calls,
    getAfterRecomputeMs: after.ms, writeLogMatchesAfter: after.calls, value,
});
