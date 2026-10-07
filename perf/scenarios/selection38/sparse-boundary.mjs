/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';
const {Carburetor} = await load();
const size = Number(process.argv[2] || 4000);
const counts = size === 4000 ? [1023, 1025, 1100] : [2500];
class Store extends Carburetor {
    reads = 0;
    change(fn) { this.update(fn); }
    read(record) { return super.read(path => { this.reads++; record(path); }); }
}
const cases = counts.map(changed => {
    const store = new Store({rows: Array.from({length: size}, (_, id) => ({id, n: 0}))});
    const seen = [];
    const stop = store.watch(data => data.rows, (next, previous) => seen.push({next, previous}));
    try {
        store.reads = 0;
        store.change(data => { for (let index = 0; index < changed; index++) data.rows[index].n = 1; });
        const sparseReads = store.reads;
        const sparseValues = seen.length === 1 && seen[0].next.every((row, index) => row.id === index && row.n === (index < changed ? 1 : 0))
            && seen[0].previous.every((row, index) => row.id === index && row.n === 0);
        store.reads = 0;
        store.change(data => { for (const row of data.rows) row.n = 2; });
        const denseReads = store.reads;
        const denseValues = seen.length === 2 && seen[1].next.every((row, index) => row.id === index && row.n === 2)
            && seen[1].previous === seen[0].next
            && seen[0].next.every((row, index) => row.id === index && row.n === (index < changed ? 1 : 0));
        return {sparseReads, denseReads, sparseValues, denseValues, callbacks: seen.length};
    } finally { stop(); }
});
emit({
    sparseReads: cases.map(value => value.sparseReads).join(','),
    maxSparseRatio: Math.max(...cases.map(value => value.sparseReads / value.denseReads)),
    denseReads: Math.min(...cases.map(value => value.denseReads)),
    sparseValues: cases.every(value => value.sparseValues), denseValues: cases.every(value => value.denseValues),
    callbacks: cases.map(value => value.callbacks).join(','), done: true,
});
