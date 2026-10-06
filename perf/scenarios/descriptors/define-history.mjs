/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Descriptor writes under history — a redefined field plus index growth per write: one version
// and one delivery per write, and full undo/redo replays restore the exact shape.
// Args: [writes=300]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const writes = Number(process.argv[2] ?? 300);
const store = new S({count: 0, items: [0]});
const history = new CarburetorHistory(store, {limit: writes + 1});
let delivered = 0;
store.subscribe(() => delivered++);
const start = performance.now();
for (let i = 1; i <= writes; i++) {
    store.run(d => {
        Object.defineProperty(d, 'count', {value: i});
        Object.defineProperty(d.items, String(i),
            {value: i, writable: true, configurable: true, enumerable: true});
    });
}
const writeMs = performance.now() - start;
const versions = store.getVersion();
const deliveries = delivered;
let undos = 0;
const replayStart = performance.now();
while (history.undo()) undos++;
const undoneCount = store.getData().count;
const undoneLength = store.getData().items.length;
let redos = 0;
while (history.redo()) redos++;
const replayMs = performance.now() - replayStart;
history.disconnect();
emit({
    writeMs, replayMs, versions, delivered: deliveries, undos, redos, undoneCount, undoneLength,
    finalCount: store.getData().count, finalLength: store.getData().items.length,
    lastAfterRedo: store.getData().items[writes],
});
