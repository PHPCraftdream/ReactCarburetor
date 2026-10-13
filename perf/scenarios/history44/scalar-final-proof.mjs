import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, Store, scalarFixture} from './fixture.mjs';

class Meter extends api.CarburetorHistory {
    /** Completed publication proof counters. */
    boundaries = [];
    /** Counts final-path proof machinery only during completed history publication. */
    record(fact) {
        const Original = globalThis.WeakMap;
        const descriptor = Object.getOwnPropertyDescriptor;
        let weakmaps = 0, descriptors = 0;
        globalThis.WeakMap = class extends Original {
            /** Preserves intrinsic semantics while counting construction.
             *
             * @param args - intrinsic constructor arguments
             */
            constructor(...args) { super(...args); weakmaps++; }
        };
        Object.getOwnPropertyDescriptor = (...args) => { descriptors++; return descriptor(...args); };
        try { super.record(fact); }
        finally { globalThis.WeakMap = Original; Object.getOwnPropertyDescriptor = descriptor; }
        this.boundaries.push({weakmaps, descriptors});
    }
}
const p = Number(process.argv[2] ?? 32);
const depth = Number(process.argv[3] ?? 2);
const mode = process.argv[4] ?? 'repeat';
const native = process.argv[5] === 'native';
const Original = globalThis.WeakMap;
const descriptor = Object.getOwnPropertyDescriptor;
const {store, history, write, leaf} = scalarFixture(p, depth, mode, Meter, native);
const trace = [];
const dispose = store.attachPatchListener({patch: patch => {
    if (typeof patch !== 'symbol') trace.push(patch.next);
}});
let wakes = 0;
const id = store.subscribe(() => wakes++);
try {
    write();
    const writeWeakmaps = history.boundaries.reduce((sum, row) => sum + row.weakmaps, 0);
    history.boundaries = []; trace.length = 0;
    assert.equal(history.undo(), true);
    const undo = history.boundaries.at(-1);
    const expectedUndo = mode === 'separate' ? [p - 1]
        : mode === 'distinct' ? Array(p).fill(0) : Array.from({length: p}, (_, i) => p - i - 1);
    assert.deepEqual(trace, expectedUndo);
    const assertEndpoint = undone => {
        const expected = mode === 'distinct'
            ? Object.fromEntries(Array.from({length: p}, (_, i) => ['n' + i, undone ? 0 : i + 1]))
            : {n: undone ? (mode === 'separate' ? p - 1 : 0) : p};
        const actual = leaf(store.getData());
        assert.deepEqual(actual, expected);
        assert.equal(store.getData().spare, 7);
        if (native) assert.equal(store.getData().stamp.getTime(), 1000);
        else assert.equal(store.getData().stamp, null);
        return Object.values(actual).reduce((sum, value) => sum + value, 0);
    };
    const undoChecksum = assertEndpoint(true);
    history.boundaries = []; trace.length = 0;
    assert.equal(history.redo(), true);
    const redo = history.boundaries.at(-1);
    assert.deepEqual(trace, mode === 'separate' ? [p] : Array.from({length: p}, (_, i) => i + 1));
    const redoChecksum = assertEndpoint(false);
    assert.equal(undoChecksum, mode === 'separate' ? p - 1 : 0);
    assert.equal(redoChecksum, mode === 'distinct' ? p * (p + 1) / 2 : p);
    history.boundaries = [];
    store.run(d => { leaf(d)[mode === 'distinct' ? 'n' + (p - 1) : 'n'] = p; });
    assert.equal(history.boundaries.length, 0);
    assert.equal(wakes, (mode === 'separate' ? p : 1) + 2);
    const graphStore = new Store({slot: null});
    const graph = new Meter(graphStore);
    let graphWeakmaps;
    try {
        graphStore.run(d => { d.slot = {n: 1, child: {n: 2}}; });
        assert.equal(graph.undo(), true);
        graph.boundaries = [];
        assert.equal(graph.redo(), true);
        graphWeakmaps = graph.boundaries.at(-1).weakmaps;
        assert.equal(graphStore.getData().slot.child.n, 2);
    } finally { graph.disconnect(); }
    emit({p, depth, mode, native, writeWeakmaps, undoWeakmaps: undo.weakmaps,
        redoWeakmaps: redo.weakmaps, undoDescriptors: undo.descriptors, redoDescriptors: redo.descriptors,
        graphWeakmaps, undoChecksum, redoChecksum, noOpBoundaries: history.boundaries.length, traceCorrect: true,
        endpointsCorrect: true, publicationCorrect: true,
        intrinsicsRestored: globalThis.WeakMap === Original && Object.getOwnPropertyDescriptor === descriptor});
} finally { dispose(); store.unsubscribe(id); history.disconnect(); }
