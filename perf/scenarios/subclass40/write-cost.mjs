/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor} = await load();
const size = 1000;
const writes = 1000;
class Store extends Carburetor { change(n) { this.update(draft => { draft.rows[n % size].n = n; }); } }
const make = () => new Store({rows: Array.from({length: size}, () => ({n: -1}))});
const plain = make();
const observed = make();
let deliveries = 0;
const ids = Array.from({length: size}, (_, i) => observed.subscribe(() => { deliveries++; },
    {reads: new Set([`rows.${i}.n`])}));
const run = store => {
    const start = performance.now();
    for (let n = 0; n < writes; n++) store.change(n);
    return performance.now() - start;
};
const controlMs = run(plain);
const writeMs = run(observed);
for (const id of ids) observed.unsubscribe(id);
const correct = observed.getData().rows.every((row, i) => row.n === i)
    && plain.getData().rows.every((row, i) => row.n === i);
emit({writeMs, controlMs, deliveries, writes, size,
    done: correct && deliveries === writes && observed.getVersion() === writes && plain.getVersion() === writes});
