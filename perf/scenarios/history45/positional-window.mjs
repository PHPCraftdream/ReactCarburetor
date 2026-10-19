/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Positional attribution compares and attributes only the affected index window of a range op;
// the whole-array snapshot copy remains, so the claimed saving is the per-index comparison and
// attribution work, not the copy. The gate counts hasOwnProperty probes (two per visited index)
// for window ops on a 10k array; head ops legitimately visit every index and act as the
// positive control. Every op's result is compared with the same operation on a plain JS array.
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {Store, countHasOwn, rowsOf} from './fixture.mjs';

const rows = Number(process.argv[2] ?? 10000);
const NEW_ROW = {id: -9, n: -1};

const OPS = {
    tailSplice: {op: draft => { draft.list.splice(rows - 1, 1); },
        mirror: list => list.splice(rows - 1, 1)},
    replaceSplice: {op: draft => { draft.list.splice(100, 1, {...NEW_ROW}); },
        mirror: list => list.splice(100, 1, {...NEW_ROW})},
    fillWindow: {op: draft => { draft.list.fill(NEW_ROW, 200, 208); },
        mirror: list => list.fill(NEW_ROW, 200, 208)},
    copyWindow: {op: draft => { draft.list.copyWithin(300, 500, 506); },
        mirror: list => list.copyWithin(300, 500, 506)},
    headSplice: {op: draft => { draft.list.splice(0, 1); },
        mirror: list => list.splice(0, 1)},
    shiftAll: {op: draft => { draft.list.shift(); },
        mirror: list => list.shift()},
};

const metrics = {};
let allCorrect = true;
for (const [name, spec] of Object.entries(OPS)) {
    const fresh = () => rowsOf(rows);
    const store = new Store({list: fresh(), other: 0});
    const probe = countHasOwn(() => store.run(spec.op));
    const live = store.getData().list;
    const mirror = fresh();
    spec.mirror(mirror);
    let correct = live.length === mirror.length
        && live.every((row, index) => {
            const expected = mirror[index];
            return row === expected || (row.id === expected.id && row.n === expected.n);
        });
    assert.equal(store.getData().other, 0);
    allCorrect &&= correct;
    metrics[name + 'Own'] = probe.calls;
    metrics[name + 'Correct'] = correct;
}
metrics.rows = rows;
metrics.allCorrect = allCorrect;
emit(metrics);
