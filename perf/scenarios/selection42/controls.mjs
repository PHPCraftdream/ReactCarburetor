/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load, engineKey} from '../../harness/lib.mjs';
const {Carburetor, transaction} = await load();
class Store extends Carburetor {
    run(fn) { this.update(fn); }
    // Existing protected publication protocol, deliberately without raw-target attribution.
    unattributed(peer, paths) {
        this.data.other = peer; peer.n = 3; this.data.tick = 2;
        for (const path of paths) this[engineKey('recordWrite', this)](path);
        this.emitUpdate();
    }
}
const observe = (store, select) => {
    const seen = [], before = [];
    const stop = store.watch(select, (next, previous) => { seen.push(next); before.push(previous); });
    return {seen, before, stop};
};
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
// Inside dense batch must still reconcile every changed child, and preserve detached history.
const dense = new Store({tick: 0, box: Object.fromEntries(Array.from({length: 128}, (_, n) => ['k' + n, {n}]))});
const a = observe(dense, d => (void d.tick, d.box));
dense.run(d => { for (let i = 0; i < 128; i++) d.box['k' + i].n += 1000; });
assert.equal(a.seen.length, 1);
for (let i = 0; i < 128; i++) { assert.equal(a.before[0]['k' + i].n, i); assert.equal(a.seen[0]['k' + i].n, i + 1000); }
const denseChecksum = Object.values(a.seen[0]).reduce((sum, row) => sum + row.n, 0);
assert.equal(denseChecksum, 136128); a.stop();
// Public ancestor and root installation routes, not simulated planner inputs.
const replacements = new Store({tick: 0, parent: {box: {k0: {n: 1}, k1: {n: 2}}}});
const r = observe(replacements, d => (void d.tick, d.parent.box));
replacements.run(d => { d.parent = {box: {k0: {n: 3}, k1: {n: 4}}}; });
replacements.setData({tick: 1, parent: {box: {k0: {n: 5}, k1: {n: 6}}}});
assert.equal(r.seen.length, 2);
assert.equal(r.before[0].k0.n, 1); assert.equal(r.before[1].k0.n, 3);
assert.equal(r.seen[1].k0.n + r.seen[1].k1.n, 11); r.stop();
// Native-to-plain alias and self cycle: outside paths cannot substitute for raw-target proof.
const peer = {n: 1}, date = new Date(1000), node = {n: 0, link: new Map()};
node.link.set('self', node); node.link.set('peer', peer); node.link.set('date', date);
const native = new Store({tick: 0, node, peer, date});
const b = observe(native, d => (void d.tick, d.node));
native.run(d => { d.tick++; }); assert.equal(b.seen.length, 0);
native.run(d => { d.peer.n = 2; }); assert.equal(b.seen.length, 1);
assert.equal(b.before[0].link.get('peer').n, 1); assert.equal(b.seen[0].link.get('peer').n, 2);
native.run(d => { d.date.setTime(2000); });
const rawDateAutoDeliveries = b.seen.length - 1;
assert.equal(rawDateAutoDeliveries, 0); // Existing native coarse contract, not a promised native-to-native wake.
native.run(d => { d.tick++; }); assert.equal(b.seen.length, 2);
assert.equal(b.before[1].link.get('date').getTime(), 1000);
assert.equal(b.seen[1].link.get('date').getTime(), 2000);
native.run(d => { d.peer = {n: 3}; d.tick++; }); assert.equal(b.seen.length, 2);
for (const snapshot of [...b.seen, ...b.before]) assert.equal(snapshot.link.get('self'), snapshot);
const nativeChecksum = b.seen[1].link.get('peer').n + b.seen[1].link.get('date').getTime();
assert.equal(nativeChecksum, 2002); b.stop();
// Sparse holes and own-undefined are distinct snapshots, even with explicit outside wakes.
const rows = []; rows.length = 64; rows[0] = {n: 0}; rows[63] = {n: 63};
const sparse = new Store({tick: 0, rows}); const c = observe(sparse, d => (void d.tick, d.rows));
sparse.run(d => { d.tick++; }); assert.equal(c.seen.length, 0);
sparse.run(d => { d.rows[7] = undefined; });
assert.ok(has(c.seen[0], 7)); assert.equal(c.seen[0][7], undefined); assert.ok(!has(c.before[0], 7));
sparse.run(d => { delete d.rows[7]; });
assert.ok(!has(c.seen[1], 7)); assert.ok(has(c.before[1], 7));
sparse.run(d => { d.rows[63].n = 64; });
assert.equal(c.seen.length, 3); assert.equal(c.seen[2].length, 64);
assert.equal(c.before[2][63].n, 63); assert.equal(c.seen[2][63].n, 64);
assert.ok(!has(c.seen[2], 1)); assert.equal(c.seen[2][0], c.seen[1][0]); c.stop();
// Overflow of accumulated targets: old Map member is still mutated despite ordinary-edge replacements.
const other = {n: 1}, linked = {n: 1}; linked.link = new Map([['self', linked], ['peer', other]]);
const overflow = new Store({node: linked, other, tick: 0});
const o = observe(overflow, d => (void d.tick, d.node));
overflow.run(d => {
    d.other.n = 2;
    for (let i = 0; i < 4100; i++) d.other = {n: i + 3};
    d.tick = 1;
});
assert.equal(o.seen.length, 1); assert.equal(o.seen[0].link.get('peer').n, 2);
assert.equal(o.before[0].link.get('peer').n, 1); assert.equal(o.seen[0].link.get('self'), o.seen[0]);
assert.equal(overflow.getData().other.n, 4102); o.stop();
// Same existing API as selection38/footprint-lifecycle; frozen reviewed build supports it.
const unknownPeer = {n: 1}, unknownNode = {n: 1};
unknownNode.link = new Map([['self', unknownNode], ['peer', unknownPeer]]);
const unknown = new Store({node: unknownNode, other: {n: 1}, tick: 0});
let lastPath; const view = unknown.read(path => { lastPath = path; });
void view.other.n; const otherPath = lastPath; void view.tick; const tickPath = lastPath;
const u = observe(unknown, d => (void d.tick, d.node));
transaction(() => {
    unknown.run(d => { d.other.n = 2; d.tick = 1; });
    unknown.unattributed(unknownPeer, [otherPath, tickPath]);
});
assert.equal(u.seen.length, 1); assert.equal(u.seen[0].link.get('peer').n, 3);
assert.equal(u.before[0].link.get('peer').n, 1); assert.equal(u.seen[0].link.get('self'), u.seen[0]); u.stop();
emit({denseDeliveries: a.seen.length, denseChecksum, replacementDeliveries: r.seen.length,
    replacementChecksum: r.seen[1].k0.n + r.seen[1].k1.n, nativeDeliveries: b.seen.length, nativeChecksum, rawDateAutoDeliveries,
    sparseDeliveries: c.seen.length, sparseChecksum: c.seen[2][0].n + c.seen[2][63].n,
    overflowDeliveries: o.seen.length, overflowMember: o.seen[0].link.get('peer').n,
    overflowSource: overflow.getData().other.n, unknownDeliveries: u.seen.length,
    unknownMember: u.seen[0].link.get('peer').n, detachedHistory: true, sparseOwnUndefined: true,
    ancestorRootCorrect: true, rawExposureCorrect: true, conservativeCorrect: true, done: true});
