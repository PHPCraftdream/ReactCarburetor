/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, median} from '../../harness/lib.mjs';
import {types} from 'node:util';
const {Carburetor} = await load();
const count = Number(process.argv[2] ?? 10000);
const where = process.argv[3] ?? 'middle';
const at = where === 'first' ? 0 : count >> 1;
class Store extends Carburetor {
    paths = [];
    run(fn) { this.update(fn); }
    emitUpdate(installation, deferred) {
        this.paths = [...this.writes];
        super.emitUpdate(installation, deferred);
    }
}
const make = () => new Store({rows: Array.from({length: count}, (_, id) => ({id, title: 'T' + id, done: id % 2 === 0}))});
const measure = mode => {
    const store = make();
    const raw = store.getData().rows;
    const before = raw.slice();
    const version = store.getVersion();
    let wokenOf200 = 0;
    const subscriptions = [];
    for (let i = 0; i < 200; i++) subscriptions.push(store.subscribe(() => { wokenOf200++; }, {reads: new Set(['rows.' + (i * 37 % count) + '.title'])}));
    let discardLength = 0;
    const start = performance.now();
    store.run(draft => {
        if (mode === 'assign') draft.rows = draft.rows.filter(row => row.id !== at);
        else if (mode === 'discard') discardLength = draft.rows.filter(row => row.id !== at).length;
        else draft.rows.splice(at, 1);
    });
    const ms = performance.now() - start;
    const rows = store.getData().rows;
    const discard = mode === 'discard';
    const correctRows = rows.reduce((total, row, i) => {
        const id = discard || i < at ? i : i + 1;
        return total + Number(row === before[id] && !types.isProxy(row) && row.id === id
            && row.title === 'T' + id && row.done === (id % 2 === 0));
    }, 0);
    const unchanged = discard && rows === raw && store.getVersion() === version && rows.length === count && correctRows === count;
    const valid = discard ? unchanged && discardLength === count - 1
        : rows.length === count - 1 && correctRows === count - 1;
    const exactPaths = store.paths.length === count - at + 2 && store.paths.includes('rows.length') && store.paths.includes('rows.~k')
        && store.paths.every(path => path === 'rows.length' || path === 'rows.~k' || /^rows\.\d+$/.test(path) && Number(path.slice(5)) >= at);
    for (const subscription of subscriptions) store.unsubscribe(subscription);
    return {ms, paths: store.paths.length, wokenOf200, valid, exactPaths, unchanged, correctRows, discardLength};
};
const filtered = [], filterOnly = [], spliced = [];
const orders = [
    ['assign', 'discard', 'splice'], ['splice', 'discard', 'assign'],
    ['discard', 'assign', 'splice'], ['splice', 'assign', 'discard'],
    ['assign', 'splice', 'discard'], ['discard', 'splice', 'assign'],
];
for (let rep = 0; rep < 18; rep++) {
    const order = orders[rep % orders.length];
    const results = Object.fromEntries(order.map(mode => [mode, measure(mode)]));
    if (rep >= 6) { filtered.push(results.assign); filterOnly.push(results.discard); spliced.push(results.splice); }
}
const filterMs = median(filtered.map(value => value.ms));
const filterOnlyMs = median(filterOnly.map(value => value.ms));
const spliceMs = median(spliced.map(value => value.ms));
emit({
    filterMs, filterOnlyMs, spliceMs, assignOverhead: filterMs / filterOnlyMs, filterOverSplice: filterMs / spliceMs,
    paths: median(filtered.map(value => value.paths)), wokenOf200: median(filtered.map(value => value.wokenOf200)),
    splicePaths: median(spliced.map(value => value.paths)), spliceWokenOf200: median(spliced.map(value => value.wokenOf200)),
    filterOnlyPaths: median(filterOnly.map(value => value.paths)), filterOnlyWokenOf200: median(filterOnly.map(value => value.wokenOf200)),
    filterOnlyUnchanged: filterOnly.every(value => value.unchanged),
    correctRows: median(filtered.map(value => value.correctRows)), filterOnlyCorrectRows: median(filterOnly.map(value => value.correctRows)),
    discardLength: median(filterOnly.map(value => value.discardLength)),
    exactPaths: filtered.every(value => value.exactPaths),
    valid: filtered.every(value => value.valid) && filterOnly.every(value => value.valid) && spliced.every(value => value.valid),
});
