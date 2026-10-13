import assert from 'node:assert/strict';
import {emit, median} from '../../harness/lib.mjs';
import {opaqueFixture, scalarFixture} from './fixture.mjs';

const family = process.argv[2] ?? 'opaque';
const n = Number(process.argv[3] ?? 32);
const k = Number(process.argv[4] ?? 3);
const padding = Number(process.argv[5] ?? 32);
const mode = process.argv[6] ?? 'native-first';
const updates = [], undos = [], redos = [];
for (let i = 0; i < 10; i++) {
    const fixture = family === 'opaque' ? opaqueFixture(n, k, padding, mode)
        : scalarFixture(n, k, mode);
    const {store, history, write} = fixture;
    let wakes = 0;
    const id = store.subscribe(() => wakes++);
    try {
        let start = performance.now();
        write();
        const updateMs = performance.now() - start;
        start = performance.now();
        const undone = history.undo();
        const undoMs = performance.now() - start;
        start = performance.now();
        const redone = history.redo();
        const redoMs = performance.now() - start;
        assert.equal(undone, mode !== 'noop');
        assert.equal(redone, mode !== 'noop');
        assert.equal(wakes, mode === 'noop' ? 0 : (mode === 'separate' ? n : 1) + 2);
        if (mode !== 'noop') {
            if (family === 'opaque') assert.equal(store.getData().slot.rows[0].n, k);
            else assert.equal(fixture.leaf(store.getData())[mode === 'distinct' ? 'n' + (n - 1) : 'n'], n);
        }
        if (i >= 3) { updates.push(updateMs); undos.push(undoMs); redos.push(redoMs); }
    } finally { store.unsubscribe(id); history.disconnect(); }
}
emit({family, n, k, padding, mode, samples: updates.length, updateMs: median(updates),
    undoMs: median(undos), redoMs: median(redos), uninstrumented: true, completedOperations: true});
