/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R6-02/R6-03: state is own enumerable string-keyed data — a symbol key and an array's non-index
// key are not state (snapshots drop them, a symbol draft write throws) — plus the old
// stateModel write/read cases: draft writes with and without history, a deep-copied setData,
// one-row restore, no-op restore, ids.push and a full read-map walk. Timings ride --against.
// Args: [rows=4000]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
const {deepClone} = await loadPath('Carburetor/Store/Utils/deepClone.mjs');
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 4000);
const buildRoot = () => {
    const items = {};
    const ids = [];
    for (let i = 0; i < rows; i++) {
        const id = 'row' + i;
        ids.push(id);
        items[id] = {title: 'title-' + i, done: i % 2 === 0, tags: ['a', 'b', 'c']};
    }
    return {items, ids, filter: ''};
};
const ROW_SAMPLE = () => ({title: 'title-7', tags: ['a', 'b', 'c'], done: false});

// A symbol key is not state: the snapshot drops it, a symbol draft write throws.
const symbol = Symbol('extra');
const symbolStore = new S({...buildRoot(), [symbol]: 'hidden'});
const symbolInSnapshot = symbol in symbolStore.snapshot();
let symbolWriteThrows = false;
try {
    symbolStore.run(draft => { draft[Symbol.for('perf6.state-model')] = 1; });
} catch {
    symbolWriteThrows = true;
}

// An array's non-index key is not state: the snapshot's clone drops it.
const rawRows = [1, 2, 3, 4];
rawRows.custom = 1;
const arrayStore = new S({rows: rawRows});
const arrayCustomInSnapshot = Object.prototype.hasOwnProperty.call(arrayStore.snapshot().rows, 'custom');

// Wake precision: one row edit wakes exactly its reader; an unchanged restore wakes nobody.
const store = new S(buildRoot());
let wakes = 0;
store.subscribe(() => { wakes++; }, {reads: ['items.row7.title']});
store.run(draft => { draft.items.row7.title = 'changed'; });
const rowEditWakes = wakes;
store.restore(store.snapshot());
const noOpRestoreWakes = wakes - rowEditWakes;
const finalTitle = store.getData().items.row7.title;

// One draft write on a fresh store, without and with a history attached.
const draftTimes = [];
for (let round = 0; round < 30; round++) {
    const target = new S(buildRoot());
    const start = performance.now();
    target.run(draft => { draft.items.row7.title = 'changed'; });
    draftTimes.push(performance.now() - start);
}
const draftMs = median(draftTimes);
const historyTimes = [];
let historyCaptures = -1;
if (typeof S.prototype.captureHistory === 'function' || typeof store.captureHistory === 'function') {
    for (let round = 0; round < 30; round++) {
        const target = new S(buildRoot());
        let captures = 0;
        const capture = target.captureHistory;
        target.captureHistory = function (own) {
            captures++;
            return capture.call(this, own);
        };
        const history = new CarburetorHistory(target);
        const start = performance.now();
        target.run(draft => { draft.items.row7.title = 'changed'; });
        historyTimes.push(performance.now() - start);
        historyCaptures = captures;
        history.disconnect();
    }
}
const draftHistoryMs = median(historyTimes);

// setData of a deep-copied root with one changed row (the fromJSON shape).
const setDataTimes = [];
let setDataTitle = '';
for (let round = 0; round < 20; round++) {
    const target = new S(buildRoot());
    const nextRoot = buildRoot();
    nextRoot.items.row7.title = 'changed';
    const start = performance.now();
    target.setData(nextRoot);
    setDataTimes.push(performance.now() - start);
    setDataTitle = target.getData().items.row7.title;
}
const setDataDeepMs = median(setDataTimes);

// restore with one changed row (siblings keep their references: the applyDiff fast path).
const restoreTimes = [];
let restoreOneTitle = '';
for (let round = 0; round < 30; round++) {
    const target = new S(buildRoot());
    const snapshot = target.snapshot();
    snapshot.items.row7.title = 'restored';
    const start = performance.now();
    target.restore(snapshot);
    restoreTimes.push(performance.now() - start);
    restoreOneTitle = target.getData().items.row7.title;
}
const restoreOneRowMs = median(restoreTimes);

// restore(snapshot()) — a no-op restore.
const noOpTimes = [];
for (let round = 0; round < 30; round++) {
    const target = new S(buildRoot());
    const snapshot = target.snapshot();
    const start = performance.now();
    target.restore(snapshot);
    noOpTimes.push(performance.now() - start);
}
const noOpRestoreMs = median(noOpTimes);

// ids.push growing the array by one row.
const pushTimes = [];
let pushLength = 0;
for (let round = 0; round < 30; round++) {
    const target = new S(buildRoot());
    const start = performance.now();
    target.run(draft => { draft.ids.push('row' + rows); });
    pushTimes.push(performance.now() - start);
    pushLength = target.getData().ids.length;
}
const pushMs = median(pushTimes);

// A full read-map walk through a fresh read view per call (the per-render read cost).
const readStore = new S(buildRoot());
let readMapTitles = 0;
const readMapTimes = [];
for (let round = 0; round < 30; round++) {
    const start = performance.now();
    const view = readStore.read(() => undefined);
    const titles = view.ids.map(id => view.items[id].title);
    readMapTimes.push(performance.now() - start);
    readMapTitles = titles.length;
}
const readMapMs = median(readMapTimes);

// deepClone of one row (report-only).
global.gc?.();
const cloneTimes = [];
for (let round = 0; round < 5; round++) {
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
        deepClone(ROW_SAMPLE());
    }
    cloneTimes.push((performance.now() - start) / 5000);
}
const cloneMs = median(cloneTimes);

// snapshot of the whole tree (the @4k entry bounds its size scale).
const snapshotTimes = [];
for (let round = 0; round < 5; round++) {
    const start = performance.now();
    store.snapshot();
    snapshotTimes.push(performance.now() - start);
}
const snapshotMs = median(snapshotTimes);

emit({
    symbolInSnapshot, arrayCustomInSnapshot, symbolWriteThrows,
    rowEditWakes, noOpRestoreWakes, finalTitle,
    historyCaptures, setDataTitle, restoreOneTitle, pushLength, readMapTitles,
    draftMs, draftHistoryMs, setDataDeepMs, restoreOneRowMs, noOpRestoreMs, pushMs, readMapMs,
    cloneMs, snapshotMs,
});
