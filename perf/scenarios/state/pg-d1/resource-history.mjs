/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R16-PERF-01: count ledger copies on originals/intermediates and descriptor installations.
import {emit, load, loadPath} from '../../../harness/lib.mjs';
import {makeRows, rowProbe} from '../../history/pg-d1/row-probe.mjs';
const {Carburetor} = await load();
const {CarburetorHistory} = await loadPath('Carburetor/Tooling/CarburetorHistory.mjs');
const {ResourceCarburetor} = await loadPath('Carburetor/Resource/ResourceCarburetor.mjs');
const rows = makeRows(10000);
const resource = new ResourceCarburetor(async () => ({rows}));
await resource.load('plain');
const probe = rowProbe(rows);
const idle = probe(() => resource.getData());
const construction = probe(() => new CarburetorHistory(resource));
const history = construction.result;
const owned = history.baseline;
const detached = owned.data.rows !== rows && owned.data.rows[0] !== rows[0];
rows[0].value = 9;
const isolated = owned.data.rows[0].value === 0;
rows[0].value = 0;
const capture = probe(() => resource.setData({...resource.getData(), data: {rows, next: true}}));
const snapshotKind = history.past.at(-1).kind;
const undoOk = history.undo() && resource.getData().data.next === undefined;
const redoOk = history.redo() && resource.getData().data.next === true;
history.disconnect();
const nativeRows = makeRows(8);
const native = {rows: nativeRows, last: new Map([[nativeRows[0], nativeRows[1]]])};
const nativeStore = new Carburetor(native);
const nativeProbe = rowProbe(nativeRows);
const nativeCapture = nativeProbe(() => new CarburetorHistory(nativeStore));
const nativeOwned = nativeCapture.result.baseline;
const nativeDetached = nativeOwned.rows[0] !== nativeRows[0]
    && nativeOwned.last.get(nativeOwned.rows[0]) === nativeOwned.rows[1];
nativeCapture.result.disconnect();
const control = probe(() => {
    const ledger = new WeakMap();
    for (const row of rows) {
        const first = {...row}; ledger.set(row, first); ledger.set(first, {...first});
        Object.defineProperty(first, 'value', {value: 1});
    }
});
emit({constructionCopies: construction.copies, constructionOriginalCopies: construction.originalCopies,
    constructionIntermediateCopies: construction.intermediateCopies, constructionDefines: construction.rowDefines,
    captureCopies: capture.copies, captureOriginalCopies: capture.originalCopies,
    captureIntermediateCopies: capture.intermediateCopies, captureDefines: capture.rowDefines,
    constructionMs: construction.ms, captureMs: capture.ms, snapshotKind,
    idleCopies: idle.copies, idleVisits: idle.originalVisits + idle.intermediateVisits,
    controlCopies: control.copies, controlDefines: control.rowDefines,
    nativeCopies: nativeCapture.copies, nativeDetached, detached, isolated, undoOk, redoOk});
