/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-01 (fan-in): an observed computed that reads a store both directly and through an inner
// computed over the same store; `get()` after an unrelated write. Args: [rows=10000] [samples=200]
import {countWriteLogMatches, emit, load, median} from '../../harness/lib.mjs';

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
const share = computed(read => read(open) / read(s).items.length);
share.subscribe(() => {});
share.get();
const matches = countWriteLogMatches(s);

global.gc?.();
const times = [];
for (let i = 0; i < samples; i++) {
    s.run(d => { d.draft = 'x' + i; });
    const start = performance.now();
    share.get();
    times.push(performance.now() - start);
}
emit({getMs: median(times), writeLogMatches: matches.calls, value: share.get()});
