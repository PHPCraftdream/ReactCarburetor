/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-04: restore() of a snapshot that differs from the live state in one leaf, next to the
// cost of taking that snapshot. Args: [rows=10000] [samples=9]
import {emit, load, median} from '../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 9);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, done: false, tags: {a: id}}))});
let wakes = 0;
s.subscribe(() => { wakes++; }, {reads: ['rows.5.done']});

global.gc?.();
const restore = [];
const snapshot = [];
for (let i = 0; i < samples; i++) {
    let start = performance.now();
    const snap = s.snapshot();
    snapshot.push(performance.now() - start);
    snap.rows[5].done = !snap.rows[5].done;
    start = performance.now();
    s.restore(snap);
    restore.push(performance.now() - start);
}
emit({restoreMs: median(restore), snapshotMs: median(snapshot), wakes, done: s.getData().rows[5].done});
