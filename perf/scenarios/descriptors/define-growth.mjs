/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Defining an index past the array's end wakes the length and key-set readers, not an
// untouched-index reader, and undo/redo restores the length in both directions.
// Args: [writes=250]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const writes = Number(process.argv[2] ?? 250);
const store = new S({items: [0]});
let lengthWakes = 0;
let keyWakes = 0;
let untouchedWakes = 0;
store.subscribe(() => { lengthWakes++; }, {reads: ['items.length']});
store.subscribe(() => { keyWakes++; }, {reads: ['items.~k']});
store.subscribe(() => { untouchedWakes++; }, {reads: ['items.0']});
const history = new CarburetorHistory(store, {limit: writes});
const start = performance.now();
for (let i = 1; i <= writes; i++) {
    store.run(d => Object.defineProperty(d.items, String(i),
        {value: i, enumerable: true, writable: true, configurable: true}));
}
const writeMs = performance.now() - start;
const writeLengthWakes = lengthWakes;
const writeKeyWakes = keyWakes;
const writeVersions = store.getVersion();
let undone = 0;
while (history.undo()) undone++;
const undoLength = store.getData().items.length;
let redone = 0;
while (history.redo()) redone++;
const redoLength = store.getData().items.length;
history.disconnect();
emit({
    writeMs, lengthWakes: writeLengthWakes, keyWakes: writeKeyWakes, untouchedWakes,
    versions: writeVersions,
    undoDepth: undone, undoLength, redoDepth: redone, redoLength, lastAfterRedo: store.getData().items[writes],
});
