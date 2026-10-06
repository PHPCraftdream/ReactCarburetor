/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R37-04: paths recorded per wake for K changed leaves on a large plain list. After the relative
// work budget, K=64 and K=65 (and K=128) stay bounded by the batch; the full-walk control reads
// the whole selection. Args: [rows=4000] [writes=1]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();

class Counting extends Carburetor {
    recorded = 0;
    read(record) { return super.read(path => { this.recorded++; record(path); }); }
}

const rows = Number(process.argv[2] ?? 4000);
const makeData = () => ({rows: Array.from({length: rows}, (_, id) => ({id, n: 1})), other: 0});
const editLeaves = (store, changed) => store.update(d => {
    for (let i = 0; i < changed; i++) d.rows[i * 2].n = i + 2;
});

const wakePaths = (store, changed) => {
    let latest = null;
    const stop = store.watch(d => d.rows, next => { latest = next; });
    store.recorded = 0;
    editLeaves(store, changed);
    const changedCount = latest.filter(row => row.n !== 1).length;
    stop();
    return {recorded: store.recorded, changedCount};
};

const at64 = wakePaths(new Counting(makeData()), 64);
const at65 = wakePaths(new Counting(makeData()), 65);
const at128 = wakePaths(new Counting(makeData()), 128);

// Control: a dense batch honestly takes the full walk and reads the whole selection.
const control = new Counting(makeData());
let controlLatest = null;
const stopControl = control.watch(d => d.rows, next => { controlLatest = next; });
control.recorded = 0;
control.update(d => { for (let i = 0; i < rows; i++) d.rows[i].n = 7; });
stopControl();

emit({
    paths64: at64.recorded,
    paths65: at65.recorded,
    paths128: at128.recorded,
    controlPaths: control.recorded,
    delivered: `${at65.changedCount}|${at128.changedCount}|${controlLatest[rows - 1].n}`,
    done: at64.changedCount === 64 && at65.changedCount === 65 && at128.changedCount === 128,
});
