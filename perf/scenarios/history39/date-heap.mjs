/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-02: retained heap per history entry for a scalar leaf write, plain state vs one Date field.
// Needs --expose-gc. Controls: replacing the Date is a genuine snapshot entry; a plain state costs the same as the Date one.
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
const rows = Number(process.argv[2] ?? 10000);
class Store extends Carburetor { run(fn) { this.update(fn); } }
const heap = () => { globalThis.gc(); globalThis.gc(); return process.memoryUsage().heapUsed; };
const state = (size, date) => ({
    items: Array.from({length: size}, (_, id) => ({id, title: 'T' + id, done: false})),
    ...(date ? {lastSync: new Date(1700000000000)} : {}),
});
const edits = {
    leaf: (d, i) => { d.items[i].title = 'x' + i; },
    date: (d, i) => { d.lastSync = new Date(1700000000000 + i + 1); },
};
const retain = (size, date, mode, steps) => {
    const store = new Store(state(size, date));
    const history = new CarburetorHistory(store, {limit: 50});
    const before = heap();
    for (let i = 0; i < steps; i++) store.run(d => edits[mode](d, i));
    const after = heap();
    const entries = history.past.length;
    const kind = history.past.at(-1)?.kind;
    let ok = entries === steps;
    if (mode === 'leaf') {
        ok &&= store.getData().items[steps - 1].title === 'x' + (steps - 1);
        ok &&= Boolean(history.undo()) && store.getData().items[steps - 1].title === 'T' + (steps - 1);
    } else {
        ok &&= store.getData().lastSync.getTime() === 1700000000000 + steps;
        ok &&= Boolean(history.undo()) && store.getData().lastSync.getTime() === 1700000000000 + steps - 1;
    }
    history.disconnect();
    return {perEntryKB: (after - before) / 1024 / Math.max(entries, 1), entries, kind, ok};
};
retain(200, true, 'leaf', 5);
retain(200, false, 'leaf', 5);
retain(200, true, 'date', 5);
const plain = retain(rows, false, 'leaf', 50);
const date = retain(rows, true, 'leaf', 50);
const snapshot = retain(rows, true, 'date', 10);
emit({
    rows, plainPerEntryKB: plain.perEntryKB, datePerEntryKB: date.perEntryKB,
    snapshotPerEntryKB: snapshot.perEntryKB, plainEntries: plain.entries, dateEntries: date.entries,
    snapshotEntries: snapshot.entries, plainKind: plain.kind, dateKind: date.kind, snapshotKind: snapshot.kind,
    done: plain.ok && date.ok && snapshot.ok,
});
