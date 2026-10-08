/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R17-ENGINE-04: the Map deliberately follows the complete plain prefix.
import {emit, load, loadPath} from '../../../harness/lib.mjs';
import {makeRows, rowProbe} from './row-probe.mjs';
const {Carburetor} = await load();
const {CarburetorHistory} = await loadPath('Carburetor/Tooling/CarburetorHistory.mjs');
const rows = makeRows(128);
const state = {rows, last: new Map()};
state.last.set(rows[0], rows[1]); state.last.set('root', state);
const store = new Carburetor(state);
const probe = rowProbe(rows);
const idle = probe(() => store.getData());
const control = probe(() => { for (const row of rows) Reflect.ownKeys(row); });
const copyControl = probe(() => {
    const ledger = new WeakMap();
    for (const row of rows) { const first = {...row}; ledger.set(row, first); ledger.set(first, {...first}); }
});
const construction = probe(() => new CarburetorHistory(store));
const history = construction.result;
const owned = history.baseline;
const detached = owned !== state && owned.rows[0] !== rows[0] && owned.last !== state.last
    && owned.last.get(owned.rows[0]) === owned.rows[1] && owned.last.get('root') === owned;
rows[0].value = 9;
const isolated = owned.rows[0].value === 0;
rows[0].value = 0;
store.setData({rows, last: new Map([[rows[0], rows[1]]])});
const undoOk = history.undo() && store.getData().last.get('root') === store.getData()
    && store.getData().last.get(store.getData().rows[0]) === store.getData().rows[1];
const redoOk = history.redo() && store.getData().last.get(store.getData().rows[0]) === store.getData().rows[1];
history.disconnect();
emit({rowVisits: construction.originalVisits, rowCopies: construction.originalCopies,
    intermediateCopies: construction.intermediateCopies, constructionMs: construction.ms,
    controlVisits: control.originalVisits, controlCopies: copyControl.copies,
    idleVisits: idle.originalVisits + idle.intermediateVisits, idleCopies: idle.copies,
    detached, isolated, undoOk, redoOk});
