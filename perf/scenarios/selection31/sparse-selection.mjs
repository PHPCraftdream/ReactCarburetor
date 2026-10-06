/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31-03: a sparse selection costs O(own indices), not O(length); the dense prefix is unchanged.
// Args: [length=65536] [variant=sparse|dense] [updates=5]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const {sameSelection} = await loadPath('Carburetor/Component/Connection/sameSelection.mjs');
const {detachOpaque} = await loadPath('Carburetor/Store/Utils/Selection/detachOpaque.mjs');

const length = Number(process.argv[2] ?? 65536);
const dense = (process.argv[3] ?? 'sparse') === 'dense';
const updates = Number(process.argv[4] ?? 5);

const makeRows = size => {
    const rows = [];
    rows.length = size;
    if (dense) {
        for (let index = 0; index < size; index++) rows[index] = index;
    } else {
        rows[0] = 0;
        rows[size - 1] = size - 1;
    }
    return rows;
};

const countIndexKeys = keys => {
    let count = 0;
    for (const key of keys) {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0 && String(index) === key) count++;
    }
    return count;
};

const rows = makeRows(length);
let detachOwnKeyCalls = 0;
let presentIndexKeys = 0;
let kernelHasOwnChecks = 0;
const originalOwnKeys = Reflect.ownKeys;
const originalHasOwn = Object.prototype.hasOwnProperty;
Reflect.ownKeys = value => {
    const keys = originalOwnKeys(value);
    if (Array.isArray(value)) {
        detachOwnKeyCalls++;
        presentIndexKeys += countIndexKeys(keys);
    }
    return keys;
};
Object.prototype.hasOwnProperty = function (key) {
    if (Array.isArray(this)) kernelHasOwnChecks++;
    return originalHasOwn.call(this, key);
};
let snapshot;
let sameContent = false;
try {
    snapshot = detachOpaque(rows);
    sameContent = sameSelection(snapshot, rows) === true;
    if (!sameContent) throw new Error('same content compared unequal');
} finally {
    Reflect.ownKeys = originalOwnKeys;
    Object.prototype.hasOwnProperty = originalHasOwn;
}
if (snapshot.length !== rows.length) throw new Error('detached length changed');
if (snapshot[0] !== 0 || snapshot[rows.length - 1] !== rows.length - 1) throw new Error('detached ends changed');
const holePreserved = dense ? true : !(1 in rows) && !(1 in snapshot);

const store = new Carburetor({marker: 0, rows});
let notifications = 0;
const stop = store.watch(data => ({parity: data.marker % 2, rows: data.rows}), () => { notifications++; });
const replacements = Array.from({length: updates}, () => makeRows(length));
let wakeChecks = 0;
Reflect.ownKeys = value => {
    const keys = originalOwnKeys(value);
    if (Array.isArray(value)) wakeChecks += keys.length;
    return keys;
};
Object.prototype.hasOwnProperty = function (key) {
    if (Array.isArray(this)) wakeChecks++;
    return originalHasOwn.call(this, key);
};
const times = [];
try {
    for (let update = 0; update < updates; update++) {
        const started = performance.now();
        store.setData({marker: (update + 1) * 2, rows: replacements[update]});
        times.push(performance.now() - started);
    }
} finally {
    Reflect.ownKeys = originalOwnKeys;
    Object.prototype.hasOwnProperty = originalHasOwn;
}
stop();
if (notifications !== 0) throw new Error(`same-content updates notified ${notifications} times`);

// A selection that really changes must notify: the parity flip crosses the selection boundary.
let parityWakes = 0;
const stopParity = store.watch(data => ({parity: data.marker % 2, rows: data.rows}), () => { parityWakes++; });
store.setData({marker: 7, rows: makeRows(length)});
stopParity();
emit({
    variant: dense ? 'dense' : 'sparse',
    detachOwnKeyCalls, presentIndexKeys, kernelHasOwnChecks, wakeChecks, notifications,
    updateMs: median(times), sameContent, parityWakes, holePreserved,
});
