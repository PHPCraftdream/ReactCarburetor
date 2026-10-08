/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-02: scalar writes before and after a genuine native snapshot boundary.
import {emit} from '../../harness/lib.mjs';
import {countOwned} from './owned-counter.mjs';
import helpers from './fixture.mjs';
const {fixture, identities, observe, valid} = helpers;
const rows = Number(process.argv[2] ?? 1000);
const construction = countOwned(() => fixture(rows));
const {store, history} = construction.result;
const counts = observe(store);
const held = identities(store);
const scalar = countOwned(() => store.write(1));
const entryKind = history.past.at(-1)?.kind;
const writeCorrect = valid(store, rows, 1, held);
const writeWakes = counts.wakes;
const writeAliasWakes = counts.aliasWakes;
const writeUnrelatedWakes = counts.unrelatedWakes;
const replacement = new Date(5678);
const control = countOwned(() => store.replaceDate(replacement));
const controlKind = history.past.at(-1)?.kind;
const afterBoundary = identities(store);
const post = countOwned(() => store.write(2));
const postSnapshotKind = history.past.at(-1)?.kind;
const postSnapshotCorrect = valid(store, rows, 2, afterBoundary, 5678);
const postUndone = history.undo() && valid(store, rows, 1, afterBoundary, 5678);
const controlUndone = history.undo() && valid(store, rows, 1);
const initialUndone = history.undo() && valid(store, rows, 0);
const initialRedone = history.redo() && valid(store, rows, 1);
const controlRedone = history.redo() && valid(store, rows, 1, undefined, 5678);
const postRedone = history.redo() && valid(store, rows, 2, undefined, 5678);
emit({
    rows, entryKind, ownedClones: scalar.ownedClones, clonedNodes: scalar.clonedNodes,
    constructionClones: construction.ownedClones, constructionNodes: construction.clonedNodes,
    constructionDateClones: construction.dateClones,
    controlKind, controlOwnedClones: control.ownedClones, controlClonedNodes: control.clonedNodes,
    controlDateClones: control.dateClones,
    postSnapshotKind, postSnapshotOwnedClones: post.ownedClones, postSnapshotClonedNodes: post.clonedNodes,
    writeWakes, writeAliasWakes, writeUnrelatedWakes,
    plainAliasControlWakes: counts.plainAliasControlWakes,
    nativeAliasControlWakes: counts.nativeAliasControlWakes,
    aliasContractCorrect: counts.aliasContractCorrect,
    wakes: counts.wakes, aliasWakes: counts.aliasWakes, unrelatedWakes: counts.unrelatedWakes,
    writeCorrect, postSnapshotCorrect, postUndone, controlUndone, initialUndone,
    initialRedone, controlRedone, postRedone,
    cursorCorrect: history.canUndo() && !history.canRedo() && history.past.length === 3,
});
counts.dispose();
history.disconnect();
