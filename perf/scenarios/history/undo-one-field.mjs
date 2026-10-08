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
const timingWakes = wakes;
// PG-B1: counter windows are separate from timing and subscription diagnostics.
const countRows = (store, recorder, fn) => {
    const rawRows = new WeakSet();
    const add = state => { for (const row of state?.rows ?? []) rawRows.add(row); };
    add(store.getData());
    add(recorder.baseline);
    add(recorder.current);
    for (const entry of [...recorder.past, ...recorder.future]) {
        add(entry); add(entry.before); add(entry.after);
    }
    const keys = Object.keys;
    const ownKeys = Reflect.ownKeys;
    let visits = 0;
    Object.keys = value => { if (rawRows.has(value)) visits++; return keys(value); };
    Reflect.ownKeys = value => { if (rawRows.has(value)) visits++; return ownKeys(value); };
    try { return {visits: (() => { fn(); return visits; })()}; }
    finally { Object.keys = keys; Reflect.ownKeys = ownKeys; }
};
const emptyRowWalks = countRows(s, history, () => {}).visits;
s.run(d => { d.rows[5].done = true; });
const undoRowWalks = countRows(s, history, () => history.undo()).visits;
const probeUndone = s.getData().rows.every((row, id) =>
    row.id === id && row.title === `Row ${id}` && row.done === false && row.tags.a === id);
const redoRowWalks = countRows(s, history, () => history.redo()).visits;
const probeRedone = s.getData().rows.every((row, id) =>
    row.id === id && row.title === `Row ${id}` && row.done === (id === 5) && row.tags.a === id);
const controlStore = new S({rows: Array.from({length: rows}, (_, id) => ({id, done: false})), date: new Date(1234)});
const controlHistory = new CarburetorHistory(controlStore);
controlStore.run(d => { d.date = new Date(5678); });
const controlKind = controlHistory.past.at(-1)?.kind;
const snapshotUndoRowWalks = countRows(controlStore, controlHistory, () => controlHistory.undo()).visits;
const snapshotCorrect = controlKind === 'snapshot' && controlStore.getData().date.getTime() === 1234 &&
    controlStore.getData().rows.every((row, id) => row.id === id && !row.done);
controlHistory.disconnect();
history.disconnect();
emit({writeMs: median(write), undoMs: median(undo), redoMs: median(redo), wakes: timingWakes, done, undone,
    undoRowWalks, redoRowWalks, emptyRowWalks, snapshotUndoRowWalks, snapshotCorrect,
    probeUndone, probeRedone});
