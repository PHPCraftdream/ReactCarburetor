/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Fixed modest batches, identical warmup, alternating order; no counter hooks in timed regions.
import {emit, median} from '../../harness/lib.mjs';
import {countOwned} from './owned-counter.mjs';
import helpers from './fixture.mjs';
const {fixture, identities, observe, valid} = helpers;
const rows = Number(process.argv[2] ?? 1000);
// PG-B1: an independent plain probe also runs before patch-history APIs existed.
const construction = countOwned(() => fixture(rows, false));
const plainProbe = construction.result;
const plainWrite = countOwned(() => plainProbe.store.write(1));
const plainWriteCorrect = valid(plainProbe.store, rows, 1);
const plainUndone = plainProbe.history.undo() && valid(plainProbe.store, rows, 0);
const plainRedone = plainProbe.history.redo() && valid(plainProbe.store, rows, 1);
// Adding a Date is opaque on the current build and a snapshot on the older build.
const plainSnapshot = countOwned(() => plainProbe.store.replaceDate(new Date(5678)));
const plainMetrics = {
    plainOwnedClones: plainWrite.ownedClones, plainClonedNodes: plainWrite.clonedNodes,
    plainConstructionClones: construction.ownedClones, plainConstructionNodes: construction.clonedNodes,
    plainSnapshotClones: plainSnapshot.ownedClones, plainSnapshotNodes: plainSnapshot.clonedNodes,
    plainProbeCorrect: plainWriteCorrect && plainUndone && plainRedone &&
        plainProbe.store.getData().date.getTime() === 5678,
};
plainProbe.history.disconnect();
if (process.argv[3] === 'plain') {
    emit({...plainMetrics});
    process.exit(0);
}
const batch = 12;
const warmups = 3;
const samples = 7;
const plain = fixture(rows, false);
const native = fixture(rows);
for (const target of [plain, native]) {
    target.held = identities(target.store);
    target.counts = observe(target.store);
    target.value = 0;
    target.valid = true;
    target.patchKinds = true;
    target.write = [];
    target.undo = [];
    target.redo = [];
}
const run = (target, measured) => {
    const {store, history} = target;
    let start = performance.now();
    for (let i = 0; i < batch; i++) store.write(++target.value);
    const writeMs = (performance.now() - start) / batch;
    target.patchKinds &&= history.past.every(entry => entry.kind === 'patches');
    target.valid &&= valid(store, rows, target.value, target.held);
    let undoMs = 0;
    let redoMs = 0;
    for (let i = 0; i < batch; i++) {
        start = performance.now();
        const undone = history.undo();
        undoMs += performance.now() - start;
        target.valid &&= undone && store.getData().rows[5].value === target.value - 1;
        start = performance.now();
        const redone = history.redo();
        redoMs += performance.now() - start;
        target.valid &&= redone && store.getData().rows[5].value === target.value;
    }
    target.valid &&= valid(store, rows, target.value, target.held);
    if (measured) {
        target.write.push(writeMs);
        target.undo.push(undoMs / batch);
        target.redo.push(redoMs / batch);
    }
};
for (let sample = 0; sample < warmups + samples; sample++) {
    const order = sample % 2 ? [native, plain] : [plain, native];
    for (const target of order) run(target, sample >= warmups);
}
const probe = countOwned(() => native.store.write(++native.value));
const ownedClones = probe.ownedClones;
const clonedNodes = probe.clonedNodes;
const entryKind = native.history.past.at(-1)?.kind;
const control = countOwned(() => native.store.replaceDate(new Date(5678)));
const nativeWriteMs = median(native.write);
const plainWriteMs = median(plain.write);
const nativeUndoMs = median(native.undo);
const plainUndoMs = median(plain.undo);
const nativeRedoMs = median(native.redo);
const plainRedoMs = median(plain.redo);
const expectedWakes = (warmups + samples) * batch * 3;
emit({
    ...plainMetrics,
    rows, batch, warmups, samples, nativeWriteMs, plainWriteMs, nativeUndoMs, plainUndoMs,
    nativeRedoMs, plainRedoMs,
    nativePlainWriteRatio: nativeWriteMs / plainWriteMs,
    writeAcceptanceWithin2: nativeWriteMs / plainWriteMs <= 2,
    entryKind, ownedClones, clonedNodes, controlOwnedClones: control.ownedClones,
    controlClonedNodes: control.clonedNodes, controlDateClones: control.dateClones,
    controlKind: native.history.past.at(-1)?.kind,
    plainWakes: plain.counts.wakes, nativeWakes: native.counts.wakes,
    plainAliasWakes: plain.counts.aliasWakes, nativeAliasWakes: native.counts.aliasWakes,
    unrelatedWakes: plain.counts.unrelatedWakes + native.counts.unrelatedWakes,
    wakesCorrect: plain.counts.wakes === expectedWakes && native.counts.wakes === expectedWakes + 1 &&
        plain.counts.aliasWakes === 0 && native.counts.aliasWakes === 0,
    plainAliasControlWakes: plain.counts.plainAliasControlWakes,
    nativeAliasControlWakes: native.counts.nativeAliasControlWakes,
    aliasContractCorrect: plain.counts.aliasContractCorrect && native.counts.aliasContractCorrect,
    patchKindsCorrect: plain.patchKinds && native.patchKinds,
    statesCorrect: plain.valid && native.valid && valid(native.store, rows, native.value, undefined, 5678),
});
for (const target of [plain, native]) {
    target.counts.dispose();
    target.history.disconnect();
}
