/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R46-09: an append to, or a tail pop from, a selected list patches the container from the write log:
// member reads and fresh row copies follow the change, not the list. A popped row's copy stays
// collectable. Positive controls: an append with an in-row write and an unshift still take the full
// walk (the counter sees it) and deliver exact values. Args: <append|pop> [rows=10000]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();

class Counting extends Carburetor {
    memberReads = 0;
    read(record) { return super.read(path => { if (/^rows\.[^.]+\./.test(path)) this.memberReads++; record(path); }); }
}

const mode = process.argv[2] === 'pop' ? 'pop' : 'append';
const rows = Number(process.argv[3] ?? 10000);
const makeData = () => ({rows: Array.from({length: rows}, (_, id) => ({id, value: {n: id}})), other: 0});
const exactly = (store, value) => JSON.stringify(value) === JSON.stringify(store.getData().rows);
const settle = async () => {
    for (let i = 0; i < 8; i++) { await new Promise(resolve => setImmediate(resolve)); globalThis.gc(); }
};

const store = new Counting(makeData());
let latest = null;
const stop = store.watch(d => d.rows, next => { latest = next; });
// A leaf write first, so the measured wake has a delivered snapshot to compare copies against.
store.update(d => { d.rows[0].value.n = -1; });
let baseline = latest;
store.memberReads = 0;
store.update(d => { if (mode === 'pop') d.rows.pop(); else d.rows.push({id: rows, value: {n: rows}}); });
const memberReads = store.memberReads;
const known = new Set(baseline);
const freshRows = latest.filter(row => !known.has(row)).length;
const popped = mode === 'pop' ? new WeakRef(baseline[rows - 1]) : undefined;
known.clear();
baseline = null;
await settle();
const poppedCopyCollected = popped === undefined || popped.deref() === undefined;
const delivered = `${latest.length}|${latest[latest.length - 1].id}`;
const exact = exactly(store, latest);
stop();

const control = edit => {
    const probe = new Counting(makeData());
    let value = null;
    const stopProbe = probe.watch(d => d.rows, next => { value = next; });
    probe.memberReads = 0;
    probe.update(edit);
    stopProbe();
    return {reads: probe.memberReads, exact: exactly(probe, value)};
};
const inRow = control(d => { d.rows[rows - 1].value.n = -1; d.rows.push({id: rows, value: {n: rows}}); });
const moved = control(d => { d.rows.unshift({id: -1, value: {n: -1}}); });

emit({
    memberReads,
    freshRows,
    poppedCopyCollected,
    controlReads: Math.min(inRow.reads, moved.reads),
    delivered,
    done: exact && inRow.exact && moved.exact,
});
