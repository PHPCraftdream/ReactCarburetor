/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// No deref during GC turns, no allocation pressure, finalizers, snapshots or subscriptions.
import assert from 'node:assert/strict';
import {emit, load} from './fixture.mjs';
const {Carburetor} = await load();
assert.equal(typeof global.gc, 'function', 'requires --expose-gc');
const kind = process.argv[2];
assert.ok(['date', 'map-member', 'opaque'].includes(kind));
class Opaque { constructor(row) { this.row = row; } }
function retire(mode) {
    const member = {n: 1};
    const native = kind === 'date' ? new Date(1000) : kind === 'opaque' ? new Opaque(member) : member;
    const old = {stamp: kind === 'map-member' ? null : native,
        map: new Map(kind === 'map-member' ? [['member', native]] : []),
        row: member, rows: Array.from({length: 32}, (_, n) => ({n})), marker: 0};
    const store = new Carburetor(old);
    if (mode !== 'cold') {
        const paths = new Set();
        const view = store.read(path => paths.add(path));
        assert.equal(kind === 'map-member' ? view.map.get('member') : view.stamp, native);
        assert.ok(paths.has(kind === 'map-member' ? 'map' : 'stamp'));
        if (kind !== 'date') assert.ok(paths.has('row'));
    }
    const weak = new WeakRef(old), payload = new WeakRef(old.rows);
    store.setData({stamp: null, map: new Map(), row: null, rows: [], marker: 1});
    assert.equal(store.getData().marker, 1);
    return {store, native, weak, payload, strong: mode === 'strong' ? old : undefined};
}
const cold = retire('cold'), cached = retire('cached'), strong = retire('strong');
async function turns() {
    for (let i = 0; i < 16; i++) {
        await new Promise(resolve => setImmediate(resolve));
        global.gc();
        await new Promise(resolve => setImmediate(resolve));
    }
}
const alive = value => ({root: value.weak.deref() !== undefined, payload: value.payload.deref() !== undefined});
await turns();
const before = {cold: alive(cold), cached: alive(cached), strong: alive(strong)};
const controlsValid = !before.cold.root && !before.cold.payload && before.strong.root && before.strong.payload;
// Same caller-held native, independently installed fresh root, overwrite control.
cached.store.setData({stamp: kind === 'map-member' ? null : cached.native,
    map: new Map(kind === 'map-member' ? [['member', cached.native]] : []), row: null, rows: [], marker: 2});
const overwrite = () => {
    const view = cached.store.read(() => {});
    assert.equal(kind === 'map-member' ? view.map.get('member') : view.stamp, cached.native);
};
overwrite();
await turns();
const afterOverwrite = alive(cached);
// Observable uses after both windows keep the current stores AND external native callers live.
for (const value of [cold, cached, strong]) {
    assert.equal(value.store.getData().marker, value === cached ? 2 : 1);
    assert.equal(kind === 'date' ? value.native.getTime() : kind === 'opaque' ? value.native.row.n : value.native.n,
        kind === 'date' ? 1000 : 1);
}
assert.equal(strong.strong.rows.length, 32);
emit({kind, controlsValid, before, afterOverwrite,
    cachedCollected: !before.cached.root && !before.cached.payload,
    overwriteCollected: !afterOverwrite.root && !afterOverwrite.payload, ownersAlive: true,
    interpretation: controlsValid ? 'valid controls; compare cached collection' : 'inconclusive GC controls'});
