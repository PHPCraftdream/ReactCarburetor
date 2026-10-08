/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-03: `draft.rows.length = n` must invalidate native-alias ownership. Reads inside the same
// transaction see the owners the index answers; each answer is compared with a freshly built store.
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const size = Number(process.argv[2] ?? 64);
const last = size - 1;
class Store extends Carburetor { change(fn) { this.update(fn); } }
const fillers = () => Array.from({length: last}, (_, n) => ({n}));
const owners = reads => [...reads].filter(path => /^(rows\.\d+|alias)(\.|$)/.test(path)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(',');
const capture = (view, reads) => {
    reads.clear();
    view.map.get('member');
    return {owners: owners(reads), reads: new Set(reads)};
};
// Same shape built from scratch: the ownership index is computed by a full walk.
const fresh = (listed, aliased) => {
    const member = {n: 1};
    const store = new Store({
        rows: listed ? [...fillers(), member] : fillers(), map: new Map([['member', member]]),
        ...(aliased ? {alias: member} : {}),
    });
    const reads = new Set();
    return capture(store.read(path => reads.add(path)), reads).owners;
};

const member = {n: 1};
const store = new Store({other: {n: 0}, rows: [], map: new Map([['member', member]])});
store.change(d => { d.rows = [...fillers(), member]; });
const reads = new Set();
const view = store.read(path => reads.add(path));
const initial = capture(view, reads).owners;
const readerValues = [];
const stopReader = store.watch(d => d.map.get('member').n, n => { readerValues.push(n); });
let truncated;
let aliased;
store.change(d => {
    d.rows.length = last;
    truncated = capture(view, reads);
    d.alias = member;
    aliased = capture(view, reads);
});
const wakes = {stale: 0, aliased: 0};
const staleId = store.subscribe(() => { wakes.stale++; }, {reads: truncated.reads});
const aliasedId = store.subscribe(() => { wakes.aliased++; }, {reads: aliased.reads});
// A new row lands on the path the member used to own.
store.change(d => { d.rows.push({n: 9}); });
const pushWakes = {stale: wakes.stale, aliased: wakes.aliased, reader: readerValues.length};
const lateValues = [];
const stopLate = store.watch(d => d.map.get('member').n, n => { lateValues.push(n); });
store.change(d => { d.alias.n = 7; });
store.unsubscribe(staleId);
store.unsubscribe(aliasedId);
stopReader();
stopLate();
const initialMatches = initial === fresh(true, false);
const truncatedMatches = truncated.owners === fresh(false, false);
const aliasedMatches = aliased.owners === fresh(false, true);
emit({
    size, initialOwners: initial, truncatedOwners: truncated.owners, aliasedOwners: aliased.owners,
    initialMatches, truncatedMatches, aliasedMatches,
    staleWakes: pushWakes.stale, aliasedPushWakes: pushWakes.aliased, readerPushWakes: pushWakes.reader,
    readerValues: readerValues.join(','), lateValues: lateValues.join(','),
    done: store.getData().rows.length === size && store.getData().alias.n === 7
        && store.getData().rows[last].n === 9 && store.getData().rows.every(row => row !== member),
});
