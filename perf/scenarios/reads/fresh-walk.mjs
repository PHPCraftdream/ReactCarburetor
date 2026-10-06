/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-02: constructing a fresh read tree inserts no proxy into the process-wide registry. Args: [rows=4000]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 4000);
const rows_ = Array.from({length: rows}, (_, n) => ({n}));

// Registry probe: count WeakMap inserts whose value is one of the raw rows — one per fresh proxy
// on a build with the per-proxy registry, zero on the hatched build. The control phase runs the
// same wrapper over inserts the scenario itself performs, proving the probe still sees inserts.
const rowSet = new Set(rows_);
const originalSet = WeakMap.prototype.set;
const countInserts = fn => {
    let inserts = 0;
    WeakMap.prototype.set = function (key, value) {
        if (rowSet.has(value)) inserts++;
        return originalSet.call(this, key, value);
    };
    try {
        fn();
    } finally {
        WeakMap.prototype.set = originalSet;
    }
    return inserts;
};
let total = 0;
const registryInserts = countInserts(() => {
    const s = new S({rows: rows_});
    const view = s.read(path => path);
    for (const row of view.rows) total += row.n;
});
const probeControl = countInserts(() => {
    const registry = new WeakMap();
    for (const row of rows_.slice(0, 4)) registry.set({}, row);
});
const walkSum = total;

// Timing phase: fresh store, read and full walk per sample; drop warmup samples.
const times = [];
for (let i = 0; i < 11; i++) {
    global.gc?.();
    const s = new S({rows: rows_});
    const start = performance.now();
    const view = s.read(path => path);
    let sum = 0;
    for (const row of view.rows) sum += row.n;
    times.push(performance.now() - start);
    if (sum !== walkSum) throw new Error(`walk sum mismatch: ${sum} !== ${walkSum}`);
}
const freshWalkMs = median(times.slice(2));

emit({freshWalkMs, registryInserts, probeControl, walkSum});
