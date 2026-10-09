/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, engineKey} from '../../harness/lib.mjs';
const {Carburetor, transaction} = await load();
class Store extends Carburetor {
    reads = 0;
    change(fn) { this.update(fn); }
    read(record) { return super.read(path => { this.reads++; record(path); }); }
    rawPublish(other, paths) {
        this.data.other = other; other.n = 3; this.data.tick = 2;
        for (const path of paths) this[engineKey('recordWrite', this)](path);
        this.emitUpdate();
    }
}
const rows = Array.from({length: 64}, (_, id) => ({id, n: 1, link: null}));
rows[0].link = new Map([['self', rows]]);
const store = new Store({rows, tick: 0});
let callbacks = 0; let next; let previous;
const stop = store.watch(data => (void data.tick, data.rows), (value, before) => { callbacks++; next = value; previous = before; });
store.reads = 0;
let earlyReads; let beforeLate;
for (let tick = 1; tick <= 5000; tick++) {
    store.change(data => { data.tick = tick; });
    if (tick === 1000) earlyReads = store.reads;
    if (tick === 4000) beforeLate = store.reads;
}
const lifecycleReads = store.reads; const lateReads = lifecycleReads - beforeLate; const equalCallbacks = callbacks;
store.reads = 0;
transaction(() => {
    store.change(data => { data.tick = 5001; });
    store.change(data => { data.tick = 5002; });
});
const transactionReads = store.reads; const transactionQuiet = callbacks === equalCallbacks;
const beforeActualChange = callbacks;
store.reads = 0;
store.change(data => { data.rows[1].n = 2; });
const changedReads = store.reads;
const changed = callbacks === beforeActualChange + 1 && next[1].n === 2 && previous[1].n === 1
    && next[0].link.get('self') === next && previous[0].link.get('self') === previous;
stop();
const other = {n: 1}; const node = {n: 1}; node.link = new Map([['self', node], ['peer', other]]);
const overflow = new Store({node, other, tick: 0});
const delivered = [];
const closeOverflow = overflow.watch(data => (void data.tick, data.node), (value, before) => delivered.push({value, before}));
overflow.change(data => {
    data.other.n = 2;
    for (let index = 0; index < 4100; index++) data.other = {n: index + 3};
    data.tick = 1;
});
const overflowCorrect = delivered.length === 1 && delivered[0].value.link.get('peer').n === 2
    && delivered[0].before.link.get('peer').n === 1 && delivered[0].value.link.get('self') === delivered[0].value
    && overflow.getData().other.n === 4102;
closeOverflow();
const peer = {n: 1}; const unknownNode = {n: 1};
unknownNode.link = new Map([['self', unknownNode], ['peer', peer]]);
const unattributed = new Store({node: unknownNode, other: {n: 1}, tick: 0});
const unknownDeliveries = []; let lastPath;
const view = unattributed.read(path => { lastPath = path; });
void view.other.n; const otherPath = lastPath; void view.tick; const tickPath = lastPath;
const closeUnknown = unattributed.watch(data => (void data.tick, data.node),
    (value, before) => unknownDeliveries.push({value, before}));
transaction(() => {
    unattributed.change(data => { data.other.n = 2; data.tick = 1; });
    unattributed.rawPublish(peer, [otherPath, tickPath]);
});
const unknownPublicationCorrect = unknownDeliveries.length === 1
    && unknownDeliveries[0].value.link.get('peer').n === 3
    && unknownDeliveries[0].before.link.get('peer').n === 1
    && unknownDeliveries[0].value.link.get('self') === unknownDeliveries[0].value;
closeUnknown();
const retention = new Store({other: {n: 0}});
retention.change(data => { data.other = {n: 1}; });
const ref = new WeakRef(retention.getData().other);
for (let index = 2; index <= 10001; index++) retention.change(data => { data.other = {n: index}; });
for (let index = 0; index < 8; index++) { await new Promise(resolve => setImmediate(resolve)); globalThis.gc(); }
emit({lifecycleReads, earlyReads, lateReads, equalCallbacks, transactionReads, transactionQuiet,
    changedReads, changed, overflowCorrect, unknownPublicationCorrect, expiredOwnerRetained: ref.deref() !== undefined,
    latestOwner: retention.getData().other.n, done: true});
