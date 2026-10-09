import {emit, load} from '../../harness/lib.mjs';
import {countHandlers} from './counts.mjs';
import {sameReads} from './sameReads.mjs';
const {Carburetor, computed} = await load();
const n = 1000;
class Store extends Carburetor {
    /** Paths captured during reads. */
    reads = new Set();
    /**
     * Publishes a draft mutation.
     *
     * @param fn - Draft mutation.
     */
    change(fn) { this.update(fn); }
    /**
     * Records paths alongside the caller's recorder.
     *
     * @param record - Caller recorder.
     */
    read(record) { return super.read(path => { this.reads.add(path); record(path); }); }
}
const probe = native => {
    const store = new Store({rows: Array.from({length: n}, (_, id) => ({id, done: id % 3 === 0})), other: 0});
    let filterGet = 0, filterHas = 0, active;
    const source = computed(read => {
        const rows = read(store).rows;
        const beforeGet = active?.get ?? 0, beforeHas = active?.has ?? 0;
        const selected = native ? Array.prototype.filter.call(rows, r => r.done) : rows.filter(r => r.done);
        if (active) { filterGet = active.get - beforeGet; filterHas = active.has - beforeHas; }
        return selected.map(r => r.id).join(',');
    });
    let initial;
    countHandlers(counts => { active = counts; initial = source.get(); });
    active = undefined;
    const expected = ['rows.~p', 'rows.length'];
    for (let i = 0; i < n; i++) {
        expected.push('rows.' + i + '.~p', 'rows.' + i + '.done');
        if (i % 3 === 0) expected.push('rows.' + i + '.id');
    }
    const exact = sameReads(store.reads, expected);
    const readCount = store.reads.size;
    const seen = [];
    const observer = () => seen.push(source.get());
    const subscription = source.subscribe(observer);
    const wanted = () => store.getData().rows.filter(r => r.done).map(r => r.id).join(',');
    let correct = initial === wanted();
    store.change(d => { d.other++; });
    correct &&= seen.length === 0;
    store.change(d => { d.rows[1].done = true; });
    correct &&= seen.length === 1 && seen.at(-1) === wanted();
    store.change(d => { d.rows[0] = {id: 2000, done: true}; });
    correct &&= seen.length === 2 && seen.at(-1) === wanted();
    store.change(d => { d.rows.push({id: 2001, done: true}); });
    correct &&= seen.length === 3 && seen.at(-1) === wanted();
    store.change(d => { d.rows.length = 2; });
    correct &&= seen.length === 4 && seen.at(-1) === '2000,1';
    source.unsubscribe(subscription);
    return {get: filterGet, has: filterHas, exact, readCount, deliveries: seen.length, correct};
};
const fast = probe(false), native = probe(true);
emit({gets: fast.get, has: fast.has, nativeGets: native.get, nativeHas: native.has,
    readCount: fast.readCount, nativeReadCount: native.readCount, exactReads: fast.exact && native.exact,
    deliveries: fast.deliveries, nativeDeliveries: native.deliveries, correct: fast.correct && native.correct});
