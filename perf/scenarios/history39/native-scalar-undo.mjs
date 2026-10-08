/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit} from '../../harness/lib.mjs';
import {countOwned} from './owned-counter.mjs';
import helpers from './fixture.mjs';
const {fixture, identities, observe, valid} = helpers;
const rows = Number(process.argv[2] ?? 1000);
const construction = countOwned(() => fixture(rows));
const {store, history} = construction.result;
const held = identities(store);
const counts = observe(store);
store.write(1);
const entryKind = history.past.at(-1)?.kind;
const writeCorrect = valid(store, rows, 1, held);
const undo = countOwned(() => history.undo());
const undoneCorrect = undo.result && valid(store, rows, 0, held);
const undoCursorCorrect = !history.canUndo() && history.canRedo();
const redo = countOwned(() => history.redo());
const redoneCorrect = redo.result && valid(store, rows, 1, held);
emit({
    rows, entryKind, constructionClones: construction.ownedClones,
    constructionNodes: construction.clonedNodes, constructionDateClones: construction.dateClones,
    undoOwnedClones: undo.ownedClones, undoClonedNodes: undo.clonedNodes,
    redoOwnedClones: redo.ownedClones, redoClonedNodes: redo.clonedNodes,
    plainAliasControlWakes: counts.plainAliasControlWakes,
    nativeAliasControlWakes: counts.nativeAliasControlWakes,
    aliasContractCorrect: counts.aliasContractCorrect,
    wakes: counts.wakes, aliasWakes: counts.aliasWakes, unrelatedWakes: counts.unrelatedWakes,
    writeCorrect, undoneCorrect, redoneCorrect, undoCursorCorrect,
    redoCursorCorrect: history.canUndo() && !history.canRedo() && history.past.length === 1,
});
counts.dispose();
history.disconnect();
