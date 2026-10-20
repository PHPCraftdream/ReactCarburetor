/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load} from '../../harness/lib.mjs';
import {countOwned} from '../history39/owned-counter.mjs';
const {Carburetor, CarburetorHistory} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
const store = new Store({row: {due: new Date(1000), done: false}});
const history = new CarburetorHistory(store, {limit: 50});
const wakes = {due: 0, unrelated: 0};
store.watch(data => data.row.due.getTime(), () => wakes.due++);
store.watch(data => data.row.done, () => wakes.unrelated++);
wakes.due = 0;
wakes.unrelated = 0;
const read = countOwned(() => store.run(d => { assert.equal(d.row.due.getTime(), 1000); }));
const reverted = countOwned(() => store.run(d => { d.row.due.setTime(2000); d.row.due.setTime(1000); }));
const entryCount = history.past.length;
const noWrite = entryCount === 0 && read.result === undefined &&
    reverted.result === undefined && wakes.due === 0 && wakes.unrelated === 0 &&
    store.getData().row.due.getTime() === 1000;
emit({entryCount, ownedClones: read.ownedClones + reverted.ownedClones,
    clonedNodes: read.clonedNodes + reverted.clonedNodes, dateClones: read.dateClones + reverted.dateClones,
    wakes: wakes.due + wakes.unrelated, correct: noWrite});
