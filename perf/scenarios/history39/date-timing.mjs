/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-02: wall time of one leaf write and one undo with a single Date field in the state (median of many).
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
const rows = Number(process.argv[2] ?? 10000);
const warm = 3;
const rounds = 15;
class Store extends Carburetor { run(fn) { this.update(fn); } }
const store = new Store({
    items: Array.from({length: rows}, (_, id) => ({id, title: 'T' + id, done: false})),
    lastSync: new Date(1700000000000),
});
const history = new CarburetorHistory(store, {limit: 50});
const index = i => (i * 37) % rows;
const writeMs = [];
const undoMs = [];
for (let i = 0; i < warm + rounds; i++) {
    const start = performance.now();
    store.run(d => { d.items[index(i)].title = 'x' + i; });
    if (i >= warm) writeMs.push(performance.now() - start);
}
const written = store.getData().items.every((item, id) => item.title === 'T' + id || item.title.startsWith('x'));
const allPatches = history.past.length === warm + rounds && history.past.every(entry => entry.kind === 'patches');
let undone = true;
for (let i = warm + rounds - 1; i >= 0; i--) {
    const start = performance.now();
    undone &&= Boolean(history.undo());
    if (i >= warm) undoMs.push(performance.now() - start);
}
const restored = store.getData().items.every((item, id) => item.title === 'T' + id);
let redone = true;
for (let i = 0; i < warm + rounds; i++) redone &&= Boolean(history.redo());
const final = store.getData();
const redoneCorrect = redone && final.items[index(warm + rounds - 1)].title === 'x' + (warm + rounds - 1)
    && final.lastSync.getTime() === 1700000000000;
history.disconnect();
emit({
    rows, writeMs: median(writeMs), undoMs: median(undoMs), allPatches, entries: warm + rounds,
    done: written && allPatches && undone && restored && redoneCorrect,
});
