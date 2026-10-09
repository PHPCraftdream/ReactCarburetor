/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-01: raw write targets stay strongly held only up to the proof cap (2048 pairs), not per write.
// Needs --expose-gc. WeakRef targets live until the end of the creating job, so every phase
// yields to a macrotask before collecting.
import {emit, load, engine} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const count = Number(process.argv[2] ?? 10000);
const held = 50;
const yieldJob = () => new Promise(resolve => setTimeout(resolve, 0));
class Store extends Carburetor { change(fn) { this.update(fn); } }
const store = new Store({rows: []});
let wakes = 0;
// An object selection is the consumer that turns raw-target recording on.
const stop = store.watch(d => d.rows, () => { wakes++; });
const refs = [];
const heldRefs = [];
const heldRows = [];
for (let i = 0; i < count + held; i++) {
    store.change(d => { d.rows.push({id: i, n: 0}); });
    const row = store.getData().rows[0];
    if (i < held) {
        heldRows.push(row);
        heldRefs.push(new WeakRef(row));
    } else {
        refs.push(new WeakRef(row));
    }
    store.change(d => { d.rows[0].n = 1; });
    store.change(d => { d.rows.pop(); });
}
// Controls: manually held plain objects survive, unreferenced ones do not.
const plainHeld = [];
const plainHeldRefs = [];
const freeRefs = [];
for (let i = 0; i < held; i++) {
    const object = {i};
    plainHeld.push(object);
    plainHeldRefs.push(new WeakRef(object));
}
for (let i = 0; i < count; i++) freeRefs.push(new WeakRef({i}));
await yieldJob();
globalThis.gc();
await yieldJob();
globalThis.gc();
const alive = list => list.filter(ref => ref.deref() !== undefined).length;
const survivors = alive(refs);
const storeHeldSurvivors = alive(heldRefs);
const plainHeldSurvivors = alive(plainHeldRefs);
const freeSurvivors = alive(freeRefs);
const trackedPairs = engine(store, 'writeLog')?.targets?.count ?? -1;
const rowsLeft = store.getData().rows.length;
stop();
emit({
    count, refCount: refs.length, survivors, storeHeldSurvivors, plainHeldSurvivors, freeSurvivors,
    trackedPairs, wakes, rowsLeft,
    done: rowsLeft === 0 && wakes >= count && heldRows.length === held && plainHeld.length === held
        && refs.length === count,
});
