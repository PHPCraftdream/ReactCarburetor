import assert from 'node:assert/strict';
import {emit, median} from '../../harness/lib.mjs';
import {fixture} from './fixture.mjs';

const p = Number(process.argv[2] ?? 32);
const unrelated = Number(process.argv[3] ?? 32);
const mode = process.argv[4] ?? 'one-update';
const {store, history, write} = fixture(p, unrelated, mode);
const samples = [];
let wakes = 0;
const id = store.subscribe(() => wakes++);
try {
    for (let i = 0; i < 10; i++) {
        history.clear();
        const before = wakes;
        const start = performance.now();
        write(i + 1);
        const elapsed = performance.now() - start;
        assert.equal(wakes - before, mode === 'separate' ? p : 1);
        assert.equal(history.past.length, mode === 'separate' ? p : 1);
        assert.ok(history.past.every(entry => entry.kind === 'patches'));
        assert.ok(store.getData().rows.every(row => row.n === i + 1));
        if (i >= 3) samples.push(elapsed);
    }
    emit({p, unrelated, mode, updatePublicationMs: median(samples), samples: samples.length,
        completedPublication: true, uninstrumented: true});
} finally { store.unsubscribe(id); history.disconnect(); }
