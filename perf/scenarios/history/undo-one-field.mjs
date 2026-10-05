/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-03: undo/redo of a one-field history entry as the state grows. Args: [rows=10000] [samples=9]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 9);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, done: false, tags: {a: id}}))});
const history = new CarburetorHistory(s);
let wakes = 0;
s.subscribe(() => { wakes++; }, {reads: ['rows.5.done']});

global.gc?.();
const write = [];
const undo = [];
const redo = [];
for (let i = 0; i < samples; i++) {
    let start = performance.now();
    s.run(d => { d.rows[5].done = !d.rows[5].done; });
    write.push(performance.now() - start);
    start = performance.now();
    history.undo();
    undo.push(performance.now() - start);
    start = performance.now();
    history.redo();
    redo.push(performance.now() - start);
}
const done = s.getData().rows[5].done;
history.undo();
const undone = s.getData().rows[5].done;
emit({writeMs: median(write), undoMs: median(undo), redoMs: median(redo), wakes, done, undone});
