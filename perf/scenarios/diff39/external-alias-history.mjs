/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor, CarburetorHistory} = await load();
const a = {id: 'a'}, b = {id: 'b'};
const store = new Carburetor({rows: [a, b], selected: a});
const history = new CarburetorHistory(store);
const diagnostics = [];
const originalError = console.error;
console.error = (...args) => { diagnostics.push(args.join(' ')); };
const state = () => {
    const {rows, selected} = store.getData();
    return {
        rows: rows.map(row => row.id), selected: selected.id,
        selectedIsRow0: selected === rows[0], selectedIsRow1: selected === rows[1],
        rowsAreOriginalA: rows.map(row => row === a), rowsAreOriginalB: rows.map(row => row === b),
        selectedIsOriginalA: selected === a,
    };
};
const states = {initial: state()};
const view = store.read(() => {});
const readValues = [view.rows[0].id, view.selected.id];
const exceptions = {}, receipts = {};
for (const [name, action] of [
    ['swap', () => store.update(draft => { draft.rows = [draft.rows[1], draft.rows[0]]; })],
    ['undo', () => history.undo()], ['redo', () => history.redo()],
]) {
    try { receipts[name] = action() ?? null; exceptions[name] = null; }
    catch (error) { exceptions[name] = String(error); }
    states[name] = state();
}
console.error = originalError;
emit({states, readValues, receipts, exceptions, diagnostics,
    swapSelected: states.swap.selected, undoSelected: states.undo.selected, redoSelected: states.redo.selected,
    undoRows: states.undo.rows.join(), redoRows: states.redo.rows.join(),
    receiptsOk: receipts.undo === true && receipts.redo === true,
    exceptionCount: Object.values(exceptions).filter(Boolean).length, diagnosticCount: diagnostics.length,
    valid: states.swap.rows.join() === 'b,a' && states.undo.rows.join() === 'a,b'
        && states.redo.rows.join() === 'b,a'});
