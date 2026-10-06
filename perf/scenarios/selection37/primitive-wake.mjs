/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R37-05: a watch selecting an equivalent scalar must wake with zero WeakMap/WeakSet constructions;
// the object/cycle control proves the counter still sees the full reconcile's ledgers. A changed
// scalar must still deliver. Args: [writes=1]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();

const countConstructors = run => {
    const counts = {weakmaps: 0, weaksets: 0};
    const RealWeakMap = WeakMap;
    const RealWeakSet = WeakSet;
    globalThis.WeakMap = class extends RealWeakMap {
        constructor(...args) { counts.weakmaps++; super(...args); }
    };
    globalThis.WeakSet = class extends RealWeakSet {
        constructor(...args) { counts.weaksets++; super(...args); }
    };
    try {
        run();
    } finally {
        globalThis.WeakMap = RealWeakMap;
        globalThis.WeakSet = RealWeakSet;
    }
    return counts;
};

// Equivalent scalar wake: tick 0 -> 2 touches the read leaf, tick % 2 stays 0, no callback.
const scalarStore = new Carburetor({tick: 0, noise: 0});
let scalarCallbacks = 0;
const stopScalar = scalarStore.watch(d => d.tick % 2, () => { scalarCallbacks++; });
// Exclude the draft proxy's one-time initialization from notification allocations.
scalarStore.update(d => { d.tick = 0; });
const scalarCounts = countConstructors(() => {
    scalarStore.update(d => { d.noise = 1; d.tick = 2; });
});
stopScalar();

// Changed scalar: delivered, still no graph ledgers.
const changedStore = new Carburetor({tick: 0, noise: 0});
const changedSeen = [];
const stopChanged = changedStore.watch(d => d.tick % 2, next => { changedSeen.push(next); });
changedStore.update(d => { d.tick = 0; });
const changedCounts = countConstructors(() => {
    changedStore.update(d => { d.tick = 3; });
});
stopChanged();

// Object/cycle control: a shared selection takes the full reconcile, so ledgers must be built.
const sharedStore = new Carburetor({tick: 0, tree: {value: 0}});
let latest = undefined;
const stopShared = sharedStore.watch(d => d.tree, next => { latest = next; });
sharedStore.update(d => { d.tree.peer = new Map([['self', d.tree]]); });
const objectCounts = countConstructors(() => {
    sharedStore.update(d => { d.tree.value = 5; });
});
stopShared();

emit({
    weakmapConstructors: scalarCounts.weakmaps,
    weaksetConstructors: scalarCounts.weaksets,
    changedScalarWeakmaps: changedCounts.weakmaps,
    objectControlWeakmaps: objectCounts.weakmaps,
    objectControlWeaksets: objectCounts.weaksets,
    delivered: `${scalarCallbacks}|${changedSeen.join(',')}|${latest?.value}`,
    done: scalarCallbacks === 0 && changedSeen.length === 1 && changedSeen[0] === 1 && latest?.value === 5,
});
