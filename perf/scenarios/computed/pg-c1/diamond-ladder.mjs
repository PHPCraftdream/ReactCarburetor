/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R16-06: both builds use bound markStale fields, not prototype methods.
// Wrap their registered invalidation callbacks identically, as the ladder fixture does.
import {emit, load, loadPath, engine} from '../../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const {sharedSingleton} = await loadPath('Carburetor/Store/Utils/sharedSingleton.mjs');
const edges = sharedSingleton('invalidationEdges', () => new WeakMap());
const store = new Carburetor({n: 0});
const nodes = [];
const runs = Array(26).fill(0);
let marks = 0;
for (let index = 0; index < 26; index++) {
    nodes.push(computed(read => {
        runs[index]++;
        if (index < 2) return read(store).n + index;
        return read(nodes[index - 1]) + read(nodes[index - 2]);
    }));
}
const originals = nodes.map(node => {
    const original = edges.get(engine(node, 'onDependencyChanged'));
    if (typeof original !== 'function') throw new Error('Missing registered markStale callback');
    edges.set(engine(node, 'onDependencyChanged'), () => {
        marks++;
        original();
    });
    return original;
});
const last = nodes[25];
let subscription;
let metrics;
try {
    subscription = last.subscribe(() => {}, {id: 'pg-c1-ladder'});
    const initialValue = last.get();
    runs.fill(0);
    marks = 0;
    const start = performance.now();
    store.update(draft => { draft.n = 1; });
    const value = last.get();
    metrics = {
        marks, bodyRuns: runs.reduce((sum, count) => sum + count, 0),
        everyBodyOnce: runs.every(count => count === 1), value, initialValue,
        writeMs: performance.now() - start,
    };
    runs.fill(0);
    marks = 0;
    store.update(draft => { draft.n = 2; });
    const controlValue = last.get();
    Object.assign(metrics, {
        controlMarks: marks, controlBodyRuns: runs.reduce((sum, count) => sum + count, 0),
        controlEveryBodyOnce: runs.every(count => count === 1), controlValue,
        resultChanged: controlValue !== value,
    });
} finally {
    if (subscription !== undefined) last.unsubscribe(subscription);
    nodes.forEach((node, index) => edges.set(engine(node, 'onDependencyChanged'), originals[index]));
}
emit(metrics);
