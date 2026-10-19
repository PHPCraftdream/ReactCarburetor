/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// History fold search: with a pending owned object target, every later patch used to scan all
// pending patches backwards (O(P^2) candidate reads per publication). `scans` counts candidate
// reads through the segments proxy each pending patch carries; a head splice and a bulk push
// must cost zero candidate reads. The fold controls assert the fold still ran at all: the
// fold-replace entry collapses to one patch and the endpoint holds the folded writes.
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {Store, FoldCountHistory, rowsOf} from './fixture.mjs';

const rows = Number(process.argv[2] ?? 1000);
const push = Number(process.argv[3] ?? 200);

const store = new Store({rows: rowsOf(rows), spare: {n: 0}});
const history = new FoldCountHistory(store, {limit: rows + 4});
let spliceCorrect = true;
let pushCorrect = true;
let foldControlCorrect = true;
try {
    history.scans = 0;
    history.taps = 0;
    store.run(d => { d.rows.splice(0, 1); });
    const spliceScans = history.scans;
    const spliceTaps = history.taps;
    const splicePatches = history.past.at(-1).patches.length;
    const spliced = store.getData().rows;
    spliceCorrect = spliced.length === rows - 1
        && spliced.every((row, index) => row.id === index + 1);

    assert.equal(history.undo(), true);
    spliceCorrect &&= store.getData().rows.length === rows
        && store.getData().rows.every((row, index) => row.id === index);
    assert.equal(history.redo(), true);
    spliceCorrect &&= store.getData().rows.length === rows - 1
        && store.getData().rows[0].id === 1;

    history.scans = 0;
    store.run(d => { for (let j = 0; j < push; j++) d.rows.push({id: rows + j, n: 0}); });
    const pushScans = history.scans;
    const pushPatches = history.past.at(-1).patches.length;
    pushCorrect = store.getData().rows.length === rows - 1 + push
        && store.getData().rows.at(-1).id === rows + push - 1;
    assert.equal(history.undo(), true);
    pushCorrect &&= store.getData().rows.length === rows - 1
        && store.getData().rows.at(-1).id === rows - 1;
    assert.equal(history.redo(), true);
    pushCorrect &&= store.getData().rows.at(-1).id === rows + push - 1;

    // Fold controls: a same-path replace folds to one patch holding the final endpoint, and
    // a subtree write folds into the owned copy's nested object.
    history.scans = 0;
    store.run(d => {
        d.spare = {child: {n: 1}};
        d.spare.child.n = 2;
        d.spare = {child: {n: 3}};
    });
    const controlEntry = history.past.at(-1);
    const foldControl = history.scans;
    const controlPatches = controlEntry.patches.length;
    foldControlCorrect = store.getData().spare.child.n === 3 && controlPatches === 2;
    assert.equal(history.undo(), true);
    foldControlCorrect &&= store.getData().spare.n === 0;
    assert.equal(history.redo(), true);
    foldControlCorrect &&= store.getData().spare.child.n === 3;

    emit({rows, push, spliceScans, spliceTaps, splicePatches, pushScans, pushPatches,
        foldControl, controlPatches, spliceCorrect, pushCorrect, foldControlCorrect});
} finally {
    history.disconnect();
}
