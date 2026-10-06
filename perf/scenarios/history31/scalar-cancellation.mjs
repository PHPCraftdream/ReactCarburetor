/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31-04: a canceled scalar batch (n=1 then n=0) proves cancellation without a full capture, while
// an ordinary change keeps undo/redo. Args: [rows=512]
import {emit, load, loadPath} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {CarburetorHistory} = await loadPath('Carburetor/Tooling/CarburetorHistory.mjs');
const {transaction} = await loadPath('Carburetor/Store/Transaction/transaction.mjs');

const rows = Number(process.argv[2] ?? 512);

class Store extends Carburetor {
    captures = 0;
    captureHistory(own) {
        this.captures++;
        return super.captureHistory(own);
    }
    write(value) {
        this.update(draft => { draft.value = value; });
    }
}

const store = new Store({
    value: 0,
    rows: Array.from({length: rows}, (_, rowId) => ({rowId, detail: {value: rowId}})),
});
const history = new CarburetorHistory(store);
const constructionCaptures = store.captures;
store.captures = 0;

const originalOwnKeys = Reflect.ownKeys;
const withRowVisits = fn => {
    let visits = 0;
    Reflect.ownKeys = target => {
        if (target !== null && typeof target === 'object' && Object.hasOwn(target, 'rowId')) visits++;
        return originalOwnKeys(target);
    };
    try {
        return fn(() => visits);
    } finally {
        Reflect.ownKeys = originalOwnKeys;
    }
};

const canceled = withRowVisits(getVisits => {
    const started = performance.now();
    transaction(() => {
        store.write(1);
        store.write(0);
    });
    return {rowVisits: getVisits(), ms: performance.now() - started};
});
const canceledCaptures = store.captures;
const canUndoAfterCancel = history.canUndo();

store.captures = 0;
const ordinary = withRowVisits(getVisits => {
    transaction(() => { store.write(1); });
    return {rowVisits: getVisits()};
});
const ordinaryCaptures = store.captures;
const undone = history.undo();
const valueAfterUndo = store.getData().value;
const redone = history.redo();
const valueAfterRedo = store.getData().value;

emit({
    constructionCaptures,
    canceledCaptures,
    canceledRowVisits: canceled.rowVisits,
    canUndoAfterCancel,
    canceledMs: canceled.ms,
    ordinaryCaptures,
    ordinaryRowVisits: ordinary.rowVisits,
    undone,
    valueAfterUndo,
    redone,
    valueAfterRedo,
});
