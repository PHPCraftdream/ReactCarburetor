/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
import {emit, engine, load, loadPath, median, setupReact} from '../../harness/lib.mjs';
const {transferReads} = await loadPath('Carburetor/Store/Paths/Markers/transferReads.mjs');
const {Carburetor} = await load();
const {useCarburetorValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
const count = 5000;
class Store extends Carburetor {
    captured = [];
    subscribe(callback, options = {}) {
        if (options.reads) this.captured.push(options);
        return super.subscribe(callback, options);
    }
}
const items = {};
for (let i = 0; i < count; i++) items['r' + i] = {title: 't' + i};
const source = new Store({items});
const Row = ({id}) => React.createElement('span', null, useCarburetorValue(source, d => d.items[id].title));
flushSync(() => root.render(React.createElement('div', null,
    Array.from({length: count}, (_, i) => React.createElement(Row, {key: i, id: 'r' + i}))
)));
const completed = source.captured;
const renderCorrect = container.textContent === Array.from({length: count}, (_, i) => 't' + i).join('');
flushSync(() => root.unmount());
if (completed.length !== count) throw new Error('Expected one actual hook handoff per row');
const full = Array.from({length: count}, (_, i) => {
    const reads = new Set();
    const view = source.read(path => reads.add(path));
    if (view.items['r' + i].title !== 't' + i) throw new Error('Raw recorder control lost a leaf');
    return transferReads(reads);
});
const inspect = store => {
    const index = engine(store, 'subscriberIndex');
    if (!(index?.exact instanceof Map) || !(index.branch instanceof Map)
        || !(index.readsById instanceof Map) || !(index.wildcard instanceof Set)) {
        throw new Error('SubscriberIndex instrumentation unavailable');
    }
    return [index.exact.size, index.branch.size, index.readsById.size, index.wildcard.size];
};
const callback = () => {};
const measure = sets => {
    const store = new Carburetor({items: {}});
    const ids = [];
    const start = performance.now();
    for (const options of sets) ids.push(store.subscribe(callback, options));
    const subscribeMs = performance.now() - start;
    const sizes = inspect(store);
    const release = performance.now();
    for (const id of ids) store.unsubscribe(id);
    const unsubscribeMs = performance.now() - release;
    const empty = inspect(store).every(size => size === 0);
    return {totalMs: subscribeMs + unsubscribeMs, sizes, empty};
};
measure(full); measure(completed); measure(completed); measure(full);
const runs = {completed: [], full: []};
for (let i = 0; i < 7; i++) {
    global.gc?.();
    for (const name of i % 2 ? ['completed', 'full'] : ['full', 'completed']) {
        runs[name].push(measure(name === 'completed' ? completed : full));
    }
}
const exact = runs.completed[0].sizes[0];
const branch = runs.completed[0].sizes[1];
const fullExact = runs.full[0].sizes[0];
const completedMs = median(runs.completed.map(run => run.totalMs));
const fullMs = median(runs.full.map(run => run.totalMs));
const empty = [...runs.completed, ...runs.full].every(run => run.empty);
// Count real map operations in a separate pass, outside the timing window.
const indexWork = sets => {
    const store = new Carburetor({items: {}});
    const index = engine(store, 'subscriberIndex');
    const counters = {exactVisits: 0, branchVisits: 0, exactWrites: 0, branchWrites: 0, otherWrites: 0};
    const originals = {};
    for (const method of ['get', 'set', 'delete']) {
        originals[method] = Map.prototype[method];
        Map.prototype[method] = function(...args) {
            if (method === 'get') {
                if (this === index.exact) counters.exactVisits++;
                else if (this === index.branch) counters.branchVisits++;
            } else if (this === index.exact) counters.exactWrites++;
            else if (this === index.branch) counters.branchWrites++;
            else counters.otherWrites++;
            return originals[method].apply(this, args);
        };
    }
    try {
        const ids = sets.map(options => store.subscribe(callback, options));
        for (const id of ids) store.unsubscribe(id);
    } finally {
        for (const method of ['get', 'set', 'delete']) Map.prototype[method] = originals[method];
    }
    return {...counters, work: counters.exactVisits + counters.branchVisits,
        empty: inspect(store).every(size => size === 0)};
};
const completedWork = indexWork(completed);
const fullWork = indexWork(full);
emit({exact, branch, fullExact, completedMs, fullMs, empty, renderCorrect,
    completedIndexWork: completedWork.work, fullIndexWork: fullWork.work,
    completedExactVisits: completedWork.exactVisits, completedBranchVisits: completedWork.branchVisits,
    fullExactVisits: fullWork.exactVisits, fullBranchVisits: fullWork.branchVisits,
    completedExactWrites: completedWork.exactWrites, completedBranchWrites: completedWork.branchWrites,
    fullExactWrites: fullWork.exactWrites, fullBranchWrites: fullWork.branchWrites,
    completedOtherWrites: completedWork.otherWrites, fullOtherWrites: fullWork.otherWrites,
    workEmpty: completedWork.empty && fullWork.empty,
    completedSamplesMs: runs.completed.map(run => run.totalMs), fullSamplesMs: runs.full.map(run => run.totalMs),
    completedRows: completed.length, fullPaths: full[0].reads.size, completedPaths: completed[0].reads.size});
