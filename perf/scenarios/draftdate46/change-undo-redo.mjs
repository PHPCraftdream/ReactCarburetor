/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load} from '../../harness/lib.mjs';
import {countOwned} from '../history39/owned-counter.mjs';
const {Carburetor, CarburetorHistory} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
const store = new Store({row: {due: new Date(1000), done: false}});
const history = new CarburetorHistory(store, {limit: 50});
let dueWakes = 0;
store.watch(data => data.row.due.getTime(), () => dueWakes++);
dueWakes = 0;
const changed = countOwned(() => store.run(d => d.row.due.setTime(2000)));
const changedKind = history.past.at(-1)?.kind;
const changedSnapshots = changed.ownedClones;
const changedNodes = changed.clonedNodes;
const changedDateClones = changed.dateClones;
const changedWakes = dueWakes;
const afterChange = store.getData().row.due.getTime() === 2000;
const undone = history.undo();
const undoCorrect = Boolean(undone) && store.getData().row.due.getTime() === 1000;
const redone = history.redo();
const redoCorrect = Boolean(redone) && store.getData().row.due.getTime() === 2000;
assert.ok(afterChange);
emit({changedKind, changedSnapshots, changedNodes, changedDateClones, changedWakes,
    undoCorrect, redoCorrect});
