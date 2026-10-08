/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-08: snapshot() of a plain-object state must not use Object.create per object; the {}
// literal fast path drops the counter to zero. Args: [rows=10000] [runs=31]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';
import {cloneProbes} from './pg-b1/clone-probes.mjs';

// Path verified in candidate, 171c1fa781f3 and 5fd73a1e30ae builds.
const {deepClone} = await loadPath('Carburetor/Store/Utils/deepClone.mjs');

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const runs = Number(process.argv[3] ?? 31);
const state = {rows: Array.from({length: rows}, (_, n) => ({id: n, nested: {v: n, tag: `row-${n}`} }))};
const s = new S(state);

global.gc?.();
for (let i = 0; i < 5; i++) s.snapshot();
const times = [];
for (let i = 0; i < runs; i++) {
    global.gc?.();
    const start = performance.now();
    s.snapshot();
    times.push(performance.now() - start);
}

// Mechanism probe: Object.create calls during one more snapshot, plus a control proving the
// patch still intercepts global Object.create calls — the way deepClone makes them.
const countCreates = fn => {
    const originalCreate = Object.create;
    let calls = 0;
    Object.create = (...args) => {
        calls++;
        return originalCreate(...args);
    };
    try {
        return fn(() => calls);
    } finally {
        Object.create = originalCreate;
    }
};
let snap;
const snapshotCreates = countCreates(get => { snap = s.snapshot(); return get(); });
const probeControlCreates = countCreates(get => { Object.create(null); return get(); });

emit({
    ...cloneProbes(deepClone, rows),
    snapshotMs: median(times), snapshotObjectCreates: snapshotCreates, probeControlCreates,
    copied: snap.rows[rows - 1].nested.v === rows - 1 && snap.rows[0] !== state.rows[0],
});
