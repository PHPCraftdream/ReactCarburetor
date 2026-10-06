/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-05: an observed computed and a watch reuse one persistent read tree per source — a scalar
// write recompute or fire builds no fresh tree, and the rows view the body walks keeps its
// identity across runs. Args: [rows=4000] [writes=12]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 4000);
const writes = Number(process.argv[3] ?? 12);
const rows_ = Array.from({length: rows}, (_, n) => ({n, v: n % 7}));
const checksum = rows_.reduce((sum, row) => sum + row.v, 0);

// Every read tree starts with one source.read() call, so counting calls on the store instance
// counts tree builds: zero while the persistent view is reused, one per build before R30-05.
const countReadCalls = store => {
    const original = store.read.bind(store);
    let calls = 0;
    store.read = (...args) => {
        calls++;
        return original(...args);
    };
    return () => calls;
};

// Observed computed fixture: observed, so each write triggers one recompute.
const s = new S({rows: rows_});
let previousRows;
let identityKept = 0;
const total = computed(read => {
    let sum = 0;
    const walked = read(s).rows;
    if (previousRows !== undefined) identityKept += walked === previousRows ? 1 : 0;
    previousRows = walked;
    for (const row of walked) sum += row.v;
    return sum;
});
total.subscribe(() => undefined);
total.get();
const readCalls = countReadCalls(s);
const times = [];
for (let i = 0; i < writes; i++) {
    global.gc?.();
    const start = performance.now();
    s.run(draft => { draft.rows[rows - 1 - i].v++; });
    total.get();
    times.push(performance.now() - start);
}
const recomputeReadTrees = readCalls();
const recomputeMs = median(writes > 4 ? times.slice(2) : times);
const checksumOk = total.get() === checksum + writes;

// Watch fixture: each fire must reuse the same tree too.
const s2 = new S({rows: Array.from({length: rows}, (_, n) => ({n, v: n % 7}))});
let fired = 0;
s2.watch(data => {
    let sum = 0;
    for (const row of data.rows) sum += row.v;
    return sum;
}, () => { fired++; });
const watchReadCalls = countReadCalls(s2);
const fireTimes = [];
for (let i = 0; i < writes; i++) {
    const start = performance.now();
    s2.run(draft => { draft.rows[rows - 1 - i].v++; });
    fireTimes.push(performance.now() - start);
}
const watchReadTrees = watchReadCalls();
const fireMs = median(writes > 4 ? fireTimes.slice(2) : fireTimes);

emit({recomputeMs, fireMs, recomputeReadTrees, watchReadTrees, identityKept, fired, checksumOk});
