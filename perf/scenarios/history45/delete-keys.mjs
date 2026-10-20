/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Deleting a non-last ordered string key with history attached: the delete path used to run
// Object.keys per delete and degrade the whole publication to a full-state snapshot entry.
// The gate counts Object.keys calls on the delete path and requires the entry to stay a
// patches entry with exact undo/redo key order.
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {Store, CarburetorHistory, countObjectKeys} from './fixture.mjs';

const keys = Number(process.argv[2] ?? 4096);
const victims = Number(process.argv[3] ?? 64);

const build = () => {
    const byId = {};
    for (let i = 0; i < keys; i++) byId['k' + i] = {n: i};
    return {byId, pad: 0};
};
const order = store => Object.keys(store.getData().byId);

const store = new Store(build());
const history = new CarburetorHistory(store, {limit: 8});
let singleCorrect = true;
let bulkCorrect = true;
try {
    const baselineOrder = order(store);

    // One middle-key delete.
    const single = countObjectKeys(() => store.run(d => { delete d.byId.k5; }));
    const singleEntry = history.past.at(-1);
    const afterSingle = order(store);
    singleCorrect = afterSingle.length === keys - 1 && afterSingle[4] === 'k4' && afterSingle[5] === 'k6';
    assert.equal(history.undo(), true);
    singleCorrect &&= JSON.stringify(order(store)) === JSON.stringify(baselineOrder)
        && store.getData().byId.k5.n === 5;
    assert.equal(history.redo(), true);
    singleCorrect &&= JSON.stringify(order(store)) === JSON.stringify(afterSingle);

    // Bulk middle-key deletes in one publication.
    const baselineOrder2 = order(store);
    const bulk = countObjectKeys(() => store.run(d => {
        for (let v = 0; v < victims; v++) delete d.byId['k' + (2 * v + 2)];
    }));
    const bulkEntry = history.past.at(-1);
    const afterBulk = order(store);
    bulkCorrect = afterBulk.length === keys - 1 - victims;
    assert.equal(history.undo(), true);
    bulkCorrect &&= JSON.stringify(order(store)) === JSON.stringify(baselineOrder2);
    assert.equal(history.redo(), true);
    bulkCorrect &&= JSON.stringify(order(store)) === JSON.stringify(afterBulk);
    assert.equal(history.undo(), true);
    const restoreCheck = JSON.stringify(order(store)) === JSON.stringify(baselineOrder2);

    // The last-key delete control: appending the key back is already order-true.
    const last = countObjectKeys(() => store.run(d => { delete d.byId['k' + (keys - 1)]; }));
    const lastEntry = history.past.at(-1);
    assert.equal(history.undo(), true);
    const lastCorrect = order(store).length === keys - 1 && order(store)[keys - 2] === 'k' + (keys - 1);

    emit({
        keys, victims,
        singleKeyScans: single.calls, bulkKeyScans: bulk.calls, lastKeyScans: last.calls,
        singleKeyVisits: single.visits, bulkKeyVisits: bulk.visits, lastKeyVisits: last.visits,
        singleKind: singleEntry.kind, bulkKind: bulkEntry.kind, lastKind: lastEntry.kind,
        bulkPatches: bulkEntry.kind === 'patches' ? bulkEntry.patches.length : -1,
        singleCorrect, bulkCorrect, restoreCheck, lastCorrect,
    });
} finally {
    history.disconnect();
}
