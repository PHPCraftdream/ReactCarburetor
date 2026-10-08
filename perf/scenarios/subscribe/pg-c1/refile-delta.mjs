/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R15-04: fixed-depth delta filing, not the O(reads) membership scan.
// Both builds expose register/unregister; newer builds split branch filing into methods.
import {emit, loadPath} from '../../../harness/lib.mjs';

const {SubscriberIndex} = await loadPath('Carburetor/Store/Paths/SubscriberIndex.mjs');
const {Carburetor} = await loadPath('Carburetor/Store/Carburetor.mjs');
const count = Number(process.argv[2] ?? 1000);
const base = new Set(Array.from({length: count}, (_, i) => `items.a1.f${i}`));
const added = `items.a1.f${count}`;
const grown = new Set([...base, added]);
const data = {items: {a1: Object.fromEntries([...grown].map(path => [path.split('.').at(-1), 0]))}};
const blank = () => ({exactFiles: 0, ancestorFiles: 0, exactUnfiles: 0, ancestorUnfiles: 0, unchangedExactTouches: 0});
let active;
const originals = new Map();
const proto = SubscriberIndex.prototype;
for (const method of ['register', 'unregister', 'registerBranch', 'unregisterBranch']) {
    const original = proto[method];
    if (typeof original !== 'function') continue;
    originals.set(method, original);
    proto[method] = function (...args) {
        if (active) {
            const branchMethod = method.endsWith('Branch');
            const exact = !branchMethod && args[0] === this.exact;
            const path = args[branchMethod ? 0 : 1];
            const removing = method.startsWith('unregister');
            active[exact ? (removing ? 'exactUnfiles' : 'exactFiles') : (removing ? 'ancestorUnfiles' : 'ancestorFiles')]++;
            if (exact && base.has(path)) active.unchangedExactTouches++;
        }
        return original.apply(this, args);
    };
}
const window = fn => {
    const counters = blank();
    active = counters;
    const start = performance.now();
    try { fn(); } finally { active = undefined; }
    return {...counters, ms: performance.now() - start};
};
let metrics;
try {
    const store = new Carburetor(data);
    let wakes = 0;
    const callback = () => { wakes++; };
    store.subscribe(callback, {id: 'reader', reads: base});
    const idle = window(() => {});
    const delta = window(() => store.subscribe(callback, {id: 'reader', reads: grown}));
    store.update(draft => { draft.items.a1[`f${count}`]++; });
    const addedWakes = wakes;
    wakes = 0;
    store.update(draft => { draft.items.a1.f0++; });
    const keptWakes = wakes;
    const removal = window(() => store.subscribe(callback, {id: 'reader', reads: new Set(base)}));
    wakes = 0;
    store.update(draft => { draft.items.a1[`f${count}`]++; });
    const removedWakes = wakes;
    wakes = 0;
    store.update(draft => { draft.items.a1.f0++; });
    const removalKeptWakes = wakes;
    store.unsubscribe('reader');
    wakes = 0;
    store.update(draft => { draft.items.a1.f0++; });
    metrics = {
        paths: count, depth: 3,
        ...delta, filingWork: delta.exactFiles + delta.ancestorFiles + delta.exactUnfiles + delta.ancestorUnfiles,
        idleWork: idle.exactFiles + idle.ancestorFiles + idle.exactUnfiles + idle.ancestorUnfiles,
        removalExactFiles: removal.exactFiles, removalAncestorFiles: removal.ancestorFiles,
        removalExactUnfiles: removal.exactUnfiles, removalAncestorUnfiles: removal.ancestorUnfiles,
        removalMs: removal.ms,
        addedWakes, keptWakes, removedWakes, removalKeptWakes, unsubscribedWakes: wakes,
        done: store.getData().items.a1.f0 === 3 && store.getData().items.a1[`f${count}`] === 2,
    };
} finally {
    for (const [method, original] of originals) proto[method] = original;
}
emit(metrics);
