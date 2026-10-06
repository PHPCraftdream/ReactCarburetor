/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-03: get() on an observed computed after unrelated writes must be O(1) via the
// per-subscription matched version, not a whole read-set match. Args: [rows=10000] [samples=200]
import {countWriteLogMatches, emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 200);
const s = new S({draft: '', items: Array.from({length: rows}, (_, id) => ({done: id % 2 === 0}))});
let recomputes = 0;
const open = computed(read => {
    recomputes++;
    let count = 0;
    for (const item of read(s).items) if (!item.done) count++;
    return count;
});
open.subscribe(() => {});
open.get();
const matches = countWriteLogMatches(s);

const times = [];
for (let i = 0; i < samples; i++) {
    s.run(d => { d.draft = 'x' + i; });
    if (i % 50 === 0) global.gc?.();
    const start = performance.now();
    open.get();
    times.push(performance.now() - start);
}

const unrelatedRecomputes = recomputes - 1;
const unrelatedMatches = matches.calls;
const value = open.get();
// A related write must still invalidate exactly once and change the observed value.
s.run(d => { d.items[4].done = !d.items[4].done; });
const valueAfterRelated = open.get();
emit({
    getMs: median(times), writeLogMatches: unrelatedMatches, recomputes: unrelatedRecomputes,
    relatedRecomputes: recomputes - 1 - unrelatedRecomputes, value, valueAfterRelated,
});
