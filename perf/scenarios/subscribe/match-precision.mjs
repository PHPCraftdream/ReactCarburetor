/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Precise invalidation: one changed path wakes exactly the subscriber reading it, at any
// subscriber count — setData, restore and object replacement announce the structural diff.
// The index section restores the old pathsIntersect loads: write-set matching at many
// subscribers, parent match, re-registration diffing, raw matching and retained bookkeeping.
// Args: [subscribers=1000] [samples=9]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const subscribers = Number(process.argv[2] ?? 1000);
const samples = Number(process.argv[3] ?? 9);

const buildItems = () => {
    const items = {};
    for (let i = 0; i < subscribers; i++) {
        items['item' + i] = {title: 'title-' + i, done: false};
    }
    return items;
};
const store = new S({items: buildItems(), extra: 0});
let wakes = 0;
let wildcardWakes = 0;
for (let i = 0; i < subscribers; i++) {
    store.subscribe(() => { wakes++; }, {id: 'w' + i, reads: [`items.item${i}.title`]});
}
store.subscribe(() => { wildcardWakes++; }, {id: 'all'});

// Object replacement through the draft: only item5's reader.
wakes = 0;
store.run(draft => { draft.items.item5 = {title: 'replaced', done: false}; });
const replaceWakes = wakes;

// setData with one changed leaf in a detached tree: only item7's reader.
const next = store.snapshot();
next.items.item7.title = 'changed';
wakes = 0;
store.setData(next);
const setDataWakes = wakes;

// restore with one changed row: only item9's reader.
const snap = store.snapshot();
snap.items.item9.title = 'restored';
wakes = 0;
store.restore(snap);
const restoreWakes = wakes;
const publications = wildcardWakes;

// A write nobody reads wakes none of the precise subscribers.
wakes = 0;
store.run(draft => { draft.extra = 1; });
const unmatchedWakes = wakes;

// Object replacement cost, toggling one item so every write is a real change.
global.gc?.();
const times = [];
for (let round = 0; round < samples; round++) {
    const title = round % 2 === 0 ? 'a' : 'b';
    const start = performance.now();
    store.run(draft => { draft.items.item5 = {title, done: false}; });
    times.push(performance.now() - start);
}
const replaceMs = median(times);

// The index loads: three sibling paths per subscriber over one store.
const indexWakes = Array.from({length: subscribers}, () => 0);
const indexStore = new S({items: buildItems(), order: []});
const siblingReads = i => new Set([`items.item${i}.title`, `items.item${i}.done`, `order.${i}`]);
for (let i = 0; i < subscribers; i++) {
    indexStore.subscribe(() => { indexWakes[i]++; }, {id: 'r' + i, reads: siblingReads(i)});
}
const totalWakes = () => indexWakes.reduce((sum, value) => sum + value, 0);

// One changed leaf wakes exactly its reader, at any subscriber count.
indexStore.run(draft => { draft.items.item5.title = 'x'; });
const indexOneWakes = totalWakes();

// A whole-item replacement wakes only that item's reader (the branch map's parent match).
indexStore.run(draft => { draft.items.item7 = {title: 'y', done: true}; });
const indexParentWakes = totalWakes() - indexOneWakes;

// Re-registration dropping a sibling path: the dropped path stops waking, the kept one still does.
indexStore.subscribe(() => { indexWakes[9]++; }, {id: 'r9', reads: new Set(['items.item9.title'])});
indexStore.run(draft => { draft.items.item9.done = true; });
const droppedSiblingWakes = indexWakes[9];
indexStore.run(draft => { draft.items.item9.title = 'z'; });
const keptSiblingWakes = indexWakes[9] - droppedSiblingWakes;

// One transaction changing many paths (the 500-path load): each changed item wakes its reader.
const half = Math.min(500, Math.floor(subscribers / 2));
const multiTimes = [];
let multiWakes = 0;
for (let round = 0; round < samples; round++) {
    const title = round % 2 === 0 ? 'm' : 'n';
    const before = totalWakes();
    const start = performance.now();
    indexStore.run(draft => {
        for (let i = 0; i < half; i++) draft.items['item' + i].title = title;
    });
    multiTimes.push(performance.now() - start);
    if (round === 0) multiWakes = totalWakes() - before;
}
const multiPathMs = median(multiTimes);

// One-path write cost at this subscriber count (the scale target for the 4k entry).
const oneTimes = [];
for (let round = 0; round < samples; round++) {
    const title = round % 2 === 0 ? 'p' : 'q';
    const start = performance.now();
    indexStore.run(draft => { draft.items.item5.title = title; });
    oneTimes.push(performance.now() - start);
}
const oneWriteMs = median(oneTimes);

// Raw pathsIntersect timing (report-only; the index replaced its use in delivery).
let rawMatchMs = -1;
try {
    const {pathsIntersect} = await loadPath('Carburetor/Store/Paths/Diff/pathsIntersect.mjs');
    const reads = siblingReads(0);
    const writes = new Set(Array.from({length: 500}, (_, i) => `items.item${i + 999999}.title`));
    pathsIntersect(reads, writes);
    const start = performance.now();
    for (let i = 0; i < 200; i++) pathsIntersect(reads, writes);
    rawMatchMs = (performance.now() - start) / 200;
} catch {
    // the module is absent on old builds
}

// Retained bookkeeping per subscriber: the store exists before the baseline, the caller keeps
// its own Sets, so only registration structures are counted.
const heapSample = () => {
    const heapStore = new S({items: buildItems(), order: []});
    global.gc?.();
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const retained = [];
    for (let i = 0; i < subscribers; i++) {
        const reads = siblingReads(i);
        retained.push(reads);
        heapStore.subscribe(() => undefined, {id: 'h' + i, reads});
    }
    global.gc?.();
    global.gc?.();
    if (retained.length !== subscribers || heapStore.getVersion() < 0) throw new Error('unreachable');
    return (process.memoryUsage().heapUsed - before) / subscribers;
};
global.gc?.();
const heapBytesPerSubscriber = median(Array.from({length: 3}, heapSample));

emit({
    replaceWakes, setDataWakes, restoreWakes, unmatchedWakes, publications, replaceMs,
    indexOneWakes, indexParentWakes, droppedSiblingWakes, keptSiblingWakes,
    multiWakes, multiPathMs, oneWriteMs, rawMatchMs, heapBytesPerSubscriber,
});
