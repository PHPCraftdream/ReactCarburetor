/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Independent process: precision/own-data checks never enter the liveness window.
import assert from 'node:assert/strict';
import {emit, load} from './fixture.mjs';
const {Carburetor} = await load();
class Store extends Carburetor { run(fn) { this.update(fn); } }
class Opaque { constructor() { this.tag = 1; } }
let getters = 0, aliasWakes = 0, unrelatedWakes = 0, backlinkWakes = 0;
const read = store => {
    const paths = new Set();
    assert.equal(store.read(path => paths.add(path)).native, store.getData().native);
    return paths;
};
for (const native of [new Date(1), new Opaque()]) {
    const store = new Store({native, row: {n: 1}, hidden: {n: 2}, spare: {n: 0}, padding: {n: 0}});
    assert.equal(read(store).has('row'), false);
    Object.defineProperty(native, Symbol('edge'), {value: store.getData().row});
    Object.defineProperty(native, 'hidden', {value: store.getData().hidden});
    Object.defineProperty(native, 'getter', {get() { getters++; return store.getData(); }});
    Object.defineProperty(native, Symbol('getter'), {get() { getters++; return store.getData(); }});
    assert.equal(read(store).has('row'), false);
    store.run(d => { d.padding = {n: 1}; });
    const paths = read(store);
    assert.ok(paths.has('row') && paths.has('hidden'));
    assert.equal(paths.has('*'), false);
    assert.deepEqual(read(store), paths);
    let wakes = 0;
    const id = store.subscribe(() => wakes++, {reads: paths});
    try {
        store.run(d => { d.spare.n++; }); unrelatedWakes += wakes;
        assert.equal(wakes, 0);
        store.run(d => { d.row.n++; });
        store.run(d => { d.hidden.n++; });
        assert.equal(wakes, 2); aliasWakes += wakes;
    } finally { store.unsubscribe(id); }
}
const row = {n: 1}, native = new Opaque();
Object.defineProperty(native, 'edge', {value: row});
const a = new Store({native, left: row, spare: {n: 0}});
const b = new Store({native, right: row, spare: {n: 0}});
for (let i = 0; i < 3; i++) {
    assert.ok(read(a).has('left')); assert.equal(read(a).has('right'), false);
    assert.ok(read(b).has('right')); assert.equal(read(b).has('left'), false);
}
a.setData({native, moved: row, spare: {n: 0}});
assert.ok(read(a).has('moved')); assert.equal(read(a).has('left'), false);
b.run(d => { d.right = {n: 2}; });
assert.equal(read(b).has('right'), false); assert.ok(read(a).has('moved'));
const linked = new Date(1), back = new Store({native: linked, spare: {n: 0}});
Object.defineProperty(linked, Symbol('root'), {value: back.getData()});
assert.ok(read(back).has('*'));
const id = back.subscribe(() => backlinkWakes++, {reads: read(back)});
try { back.run(d => { d.spare.n++; }); } finally { back.unsubscribe(id); }
assert.equal(backlinkWakes, 1); assert.equal(getters, 0);
emit({getters, aliasWakes, unrelatedWakes, backlinkWakes, crossRoot: true,
    generationRefresh: true, hiddenOwnData: true, precision: true});
