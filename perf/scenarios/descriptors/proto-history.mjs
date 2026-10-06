/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// History with a numeric limit bounds undo depth to the kept entries, and a literal own
// `__proto__` definition is an own data property whose undo/redo never touches the prototype.
// Args: [rows=300] [writes=250] [limit=50]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 300);
const writes = Number(process.argv[3] ?? 250);
const limit = Number(process.argv[4] ?? 50);
const board = new S({rows: Object.fromEntries(
    Array.from({length: rows}, (_, index) => ['row' + index, {title: 'initial', done: index % 2 === 0}]),
)});
const history = new CarburetorHistory(board, {limit});
const start = performance.now();
for (let i = 0; i < writes; i++) board.run(d => { d.rows['row' + (i % rows)].title = 'updated-' + i; });
const writeMs = performance.now() - start;
let undoDepth = 0;
while (history.undo()) undoDepth++;
const drained = board.getData().rows['row' + (writes - 1)].title;
const evicted = board.getData().rows.row0.title;
let redoDepth = 0;
while (history.redo()) redoDepth++;
history.disconnect();
const shape = data => ({
    own: Object.hasOwn(data, '__proto__') ? 1 : 0,
    plain: Object.getPrototypeOf(data) === Object.prototype ? 1 : 0,
});
const store = new S({count: 0, nest: {x: 1}});
const legacy = new CarburetorHistory(store);
let delivered = 0;
store.subscribe(() => delivered++);
store.run(d => Object.defineProperty(d, '__proto__',
    {value: 7, enumerable: true, writable: true, configurable: true}));
store.run(d => Object.defineProperty(d.nest, '__proto__',
    {value: {y: 2}, enumerable: true, writable: true, configurable: true}));
const writeShape = shape(store.getData());
const writeValue = store.getData().__proto__;
const protoDeliveries = delivered;
const protoVersions = store.getVersion();
legacy.undo();
legacy.undo();
const undoRoot = shape(store.getData());
const undoNest = shape(store.getData().nest);
legacy.redo();
legacy.redo();
const redoRoot = shape(store.getData());
const redoNest = shape(store.getData().nest);
legacy.disconnect();
emit({
    writeMs, undoDepth, redoDepth, drained, evicted,
    protoWriteOwn: writeShape.own, protoWritePlain: writeShape.plain, protoWriteValue: writeValue,
    protoDelivered: protoDeliveries, protoVersion: protoVersions,
    protoUndoRootOwn: undoRoot.own, protoUndoRootPlain: undoRoot.plain, protoUndoNestOwn: undoNest.own,
    protoRedoRootOwn: redoRoot.own, protoRedoRootPlain: redoRoot.plain, protoRedoNestOwn: redoNest.own,
});
