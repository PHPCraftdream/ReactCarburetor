/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// A draft defineProperty that changes no supported state records no version, delivery or history
// entry; a real value change still does, and undo/redo round-trips it exactly.
// Args: [writes=1000]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, CarburetorHistory} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const writes = Number(process.argv[2] ?? 1000);
const omit = () => {
    const store = new S({count: 1});
    let delivered = 0;
    store.subscribe(() => delivered++);
    const history = new CarburetorHistory(store, {limit: writes});
    const start = performance.now();
    for (let i = 0; i < writes; i++) {
        store.run(d => Object.defineProperty(d, 'count',
            {enumerable: true, writable: true, configurable: true}));
    }
    const ms = performance.now() - start;
    const versions = store.getVersion();
    const deliveries = delivered;
    let undone = 0;
    while (history.undo()) undone++;
    history.disconnect();
    return {ms, versions, delivered: deliveries, undone, count: store.getData().count};
};
const changed = () => {
    const store = new S({count: 1});
    let delivered = 0;
    store.subscribe(() => delivered++);
    const history = new CarburetorHistory(store, {limit: writes});
    const start = performance.now();
    for (let i = 0; i < writes; i++) {
        store.run(d => Object.defineProperty(d, 'count',
            {value: d.count + 1, enumerable: true, writable: true, configurable: true}));
    }
    const ms = performance.now() - start;
    const versions = store.getVersion();
    const deliveries = delivered;
    let undone = 0;
    while (history.undo()) undone++;
    const low = store.getData().count;
    let redone = 0;
    while (history.redo()) redone++;
    history.disconnect();
    return {ms, versions, delivered: deliveries, undone, redone, low, count: store.getData().count};
};
const o = omit();
const c = changed();
emit({
    omitMs: o.ms, omitVersions: o.versions, omitDelivered: o.delivered, omitUndoDepth: o.undone,
    changedMs: c.ms, changedVersions: c.versions, changedDelivered: c.delivered,
    changedUndoDepth: c.undone, changedRedoDepth: c.redone, restoredLow: c.low, finalCount: c.count,
});
