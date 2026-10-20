/* oxlint-disable react/globals, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load} from '../../harness/lib.mjs';
import {countOwned} from '../history39/owned-counter.mjs';

const {Carburetor, CarburetorHistory} = await load();
const rows = Number(process.argv[2] ?? 10000);
class Store extends Carburetor { run(fn) { this.update(fn); } }
const heap = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
const makeRow = (id) => ({id, due: new Date(1700000000000), scalar: 0});
const store = new Store({items: Array.from({length: rows}, (_, id) => makeRow(id))});
const history = new CarburetorHistory(store, {limit: 50});
let dateWakes = 0;
store.subscribe(() => dateWakes++, {id: 'date', reads: new Set(['items.0.due'])});
const before = heap();
let snapshots = 0;
let clones = 0;
let dateClones = 0;
for (let i = 0; i < 50; i++) {
    const measured = countOwned(() => store.run(d => {
        const current = d.items[0].due.getTime();
        d.items[0].scalar = current + i;
    }));
    snapshots += measured.ownedClones;
    clones += measured.clonedNodes;
    dateClones += measured.dateClones;
}
const after = heap();
const entries = history.past.length;
const kind = history.past.at(-1)?.kind;
const entryKindsCorrect = history.past.length === 50 && history.past.every(entry => entry.kind === 'patches');
const correct = entries === 50 && entryKindsCorrect && store.getData().items[0].scalar === 1700000000049 &&
    store.getData().items[0].due.getTime() === 1700000000000 && dateWakes === 0;
assert.ok(correct);
const datePerEntryKB = (after - before) / 1024 / entries;
history.disconnect();
emit({rows, datePerEntryKB, dateEntries: entries, dateKind: kind, dateSnapshots: snapshots,
    dateClones: clones + dateClones, dateWakes, dateEntryKinds: entryKindsCorrect, done: correct});
