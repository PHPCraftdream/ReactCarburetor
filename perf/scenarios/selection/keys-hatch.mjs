/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R33-04: compare and detach read view keys through the internal hatch, never Object.keys or
// Reflect.ownKeys on a live view — watched over EVERY view of the selection (the array view and
// each row view), with a self-check that the probe counts a deliberate enumeration.
// Args: [rows=10000] [runs=12]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {sameSelection} = await loadPath('Carburetor/Component/Connection/sameSelection.mjs');
const {detachOpaque} = await loadPath('Carburetor/Store/Utils/Selection/detachOpaque.mjs');
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const runs = Number(process.argv[3] ?? 12);

const rows_ = Array.from({length: rows}, (_, id) => ({id, title: 'title-0', done: false, tags: {a: 1}}));
const s = new S({rows: rows_});
const view = s.read(() => undefined);
void view.rows[0].id; // warm one read tree

// Every view of the selection: the array view and each row view.
const viewSet = new Set([view.rows]);
for (const row of view.rows) viewSet.add(row);
const snapshot = Array.from({length: rows}, (_, id) => ({id, title: 'title-0', done: false, tags: {a: 1}}));

// Count both enumeration primitives over any watched view; the hatch must keep both at zero.
let keysOnViews = 0;
const originalKeys = Object.keys;
const originalOwnKeys = Reflect.ownKeys;
Object.keys = function (value) {
    if (viewSet.has(value)) keysOnViews++;
    return originalKeys(value);
};
Reflect.ownKeys = function (value) {
    if (viewSet.has(value)) keysOnViews++;
    return originalOwnKeys(value);
};

// Self-check: the same wrappers must count a deliberate enumeration of watched views.
Object.keys(view.rows[0]);
Reflect.ownKeys(view.rows);
const probeSelfCount = keysOnViews;
keysOnViews = 0;

const sameVerdict = sameSelection(snapshot, view.rows);
const sameKeysOnViews = keysOnViews;
keysOnViews = 0;

const detached = detachOpaque(view.rows);
const detachKeysOnViews = keysOnViews;
Object.keys = originalKeys;
Reflect.ownKeys = originalOwnKeys;

const detachOk = Array.isArray(detached) && detached.length === rows && detached[0] !== view.rows[0] && detached[0].title === 'title-0';

let sink = 0;
const sameBody = () => {
    const verdict = sameSelection(snapshot, view.rows);
    sink += verdict ? 1 : 0;
};
const detachBody = () => {
    const copy = detachOpaque(view.rows);
    sink += copy.length === rows ? 1 : 0;
};
sameBody();
detachBody();
for (let i = 0; i < 2; i++) { sameBody(); detachBody(); } // warmup
const sameSamples = [];
const detachSamples = [];
for (let r = 0; r < runs; r++) {
    let start = process.hrtime.bigint();
    sameBody();
    sameSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
    start = process.hrtime.bigint();
    detachBody();
    detachSamples.push(Number(process.hrtime.bigint() - start) / 1e6);
}
void sink;

emit({sameMs: median(sameSamples), detachMs: median(detachSamples), sameKeysOnViews, detachKeysOnViews, probeSelfCount, sameVerdict, detachOk});
