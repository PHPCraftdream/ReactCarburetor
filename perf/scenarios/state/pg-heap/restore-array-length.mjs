/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R7-03: count hole probes plus enumerated own indices on the exact raw array.
// Production removes AliasLedger validation; this scenario does not claim to measure it.
import {emit, load, loadPath} from '../../../harness/lib.mjs';
const {CarburetorHistory} = await loadPath('Carburetor/Tooling/CarburetorHistory.mjs');

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }
const length = 1000000;
const sparse = [];
sparse[0] = {n: 0};
sparse[500000] = {n: 1};
sparse[length - 1] = {n: 2};
const store = new S({rows: sparse});
const raw = store.getData().rows;
const ownIndices = Object.keys(raw).length;

const measure = (array, fn) => {
    const has = Object.prototype.hasOwnProperty;
    const keys = Object.keys;
    const get = Reflect.get;
    let visits = 0;
    Object.prototype.hasOwnProperty = function (key) {
        if (this === array && /^(0|[1-9]\d*)$/.test(String(key))) visits++;
        return has.call(this, key);
    };
    Object.keys = function (value) {
        const result = keys(value);
        if (value === array) visits += result.filter(key => /^(0|[1-9]\d*)$/.test(key)).length;
        return result;
    };
    Reflect.get = function (value, key, ...rest) {
        if (value === array && /^(0|[1-9]\d*)$/.test(String(key))) visits++;
        return get(value, key, ...rest);
    };
    let result;
    try { result = fn(); } finally {
        Object.prototype.hasOwnProperty = has;
        Object.keys = keys;
        Reflect.get = get;
    }
    return {visits, result};
};
const idleVisits = measure(raw, () => store.getData().rows.length).visits;
const snapshot = measure(raw, () => store.snapshot());
const snapshotIndexVisits = snapshot.visits;
const snapshotOk = snapshot.result.rows.length === length && Object.keys(snapshot.result.rows).length === 3
    && snapshot.result.rows !== raw && snapshot.result.rows[500000] !== raw[500000]
    && snapshot.result.rows[500000].n === 1 && !(499999 in snapshot.result.rows);
let sparseHoleWakes = 0;
let sparseLengthWakes = 0;
let sparseRemovedKeyWakes = 0;
store.subscribe(() => { sparseHoleWakes++; }, {reads: ['rows.499999']});
store.subscribe(() => { sparseLengthWakes++; }, {reads: ['rows.length']});
store.subscribe(() => { sparseRemovedKeyWakes++; }, {reads: ['rows.999999']});
const history = new CarburetorHistory(store);
const truncateIndexVisits = measure(raw, () => store.run(draft => { draft.rows.length = 1; })).visits;
const sparseLengthAfter = store.getData().rows.length;
const truncateOk = sparseLengthAfter === 1 && Object.keys(raw).length === 1 && raw[0].n === 0;
history.disconnect();
const dense = new S({rows: Array.from({length: 32}, (_, n) => ({n}))});
const denseRaw = dense.getData().rows;
const denseSnapshot = measure(denseRaw, () => dense.snapshot());
const denseSnapshotIndexVisits = denseSnapshot.visits;
const denseHistory = new CarburetorHistory(dense);
const denseTruncateIndexVisits = measure(denseRaw, () => dense.run(draft => { draft.rows.length = 1; })).visits;
denseHistory.disconnect();
const denseOk = denseSnapshot.result.rows.length === 32 && denseSnapshot.result.rows[31].n === 31
    && dense.getData().rows.length === 1;
emit({length, ownIndices, snapshotIndexVisits, truncateIndexVisits, idleVisits,
    denseSnapshotIndexVisits, denseTruncateIndexVisits, snapshotOk, truncateOk, denseOk,
    sparseHoleWakes, sparseLengthWakes, sparseRemovedKeyWakes, sparseLengthAfter});
