import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {fixture, MeterHistory, ownedControl} from './fixture.mjs';

const p = Number(process.argv[2] ?? 32);
const unrelated = Number(process.argv[3] ?? 32);
const mode = process.argv[4] ?? 'one-update';
const {store, history, flush, write} = fixture(p, unrelated, mode, MeterHistory);
let all = 0, precise = 0, spare = 0;
const reads = new Set(), spareReads = new Set();
void store.read(path => reads.add(path)).rows[0].n;
void store.read(path => spareReads.add(path)).spare.n;
const ids = [store.subscribe(() => all++), store.subscribe(() => precise++, {reads}),
    store.subscribe(() => spare++, {reads: spareReads})];
const values = () => store.getData().rows.map(row => row.n);
const padding = store.getData().padding;
try {
    write(1);
    const checks = history.checks;
    const steps = mode === 'separate' ? p : 1;
    assert.equal(all, steps);
    assert.equal(precise, 1);
    assert.equal(spare, 0);
    assert.deepEqual(values(), Array(p).fill(1));
    assert.equal(history.past.length, steps);
    assert.ok(history.past.every(entry => entry.kind === 'patches'));
    assert.equal(history.past.at(-1).patches.length, mode === 'separate' ? 1 : p);
    history.checks = 0;
    store.run(d => { d.rows[0].n = 1; });
    flush();
    const empty = history.checks;
    assert.equal(empty, 0);
    history.gate = true;
    try { void history.past.at(-1).patches[0].nextExists; } finally { history.gate = false; }
    const positive = history.checks;
    assert.equal(positive, 1);
    history.restoreTaps();
    for (let i = 0; i < steps; i++) {
        assert.equal(history.undo(), true);
        flush();
        assert.deepEqual(values(), mode === 'separate'
            ? Array.from({length: p}, (_, index) => index < p - i - 1 ? 1 : 0) : Array(p).fill(0));
    }
    assert.equal(history.undo(), false);
    store.run(d => { d.rows[0].n = 2; d.rows[0].n = 0; });
    flush();
    assert.equal(history.canUndo(), false);
    assert.equal(history.canRedo(), true);
    history.restoreTaps();
    for (let i = 0; i < steps; i++) {
        assert.equal(history.redo(), true);
        flush();
        assert.deepEqual(values(), mode === 'separate'
            ? Array.from({length: p}, (_, index) => index <= i ? 1 : 0) : Array(p).fill(1));
    }
    assert.equal(history.redo(), false);
    assert.equal(spare, 0);
    assert.equal(store.getData().padding, padding);
    assert.deepEqual(padding, Array.from({length: unrelated}, (_, n) => ({n})));
    history.restoreTaps();
    emit({p, unrelated, mode, checks, empty, positive, descriptorsRestored: history.taps.length === 0,
        publicationCorrect: true, endpointsCorrect: true, cancellationCorrect: true,
        ownedTargetCorrect: ownedControl()});
} finally {
    history.restoreTaps();
    history.disconnect();
    ids.forEach(id => store.unsubscribe(id));
}
