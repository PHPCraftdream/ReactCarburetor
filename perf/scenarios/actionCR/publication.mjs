/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc, carburetor/require-emit-after-draft-write */
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, action} = await load();
const increment = (draft, n) => { draft.value += n; };
const decorate = (prototype, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    Object.defineProperty(prototype, name, {...descriptor, value: action(descriptor.value, {
        kind: 'method', name, private: false, static: false, addInitializer() {},
    })});
};
class ActionStore extends Carburetor {
    constructor() { super({value: 0}); }
    single() { this.draft.value++; }
    inner() { this.draft.value++; }
    outer() { this.inner(); this.inner(); }
}
decorate(ActionStore.prototype, 'single');
decorate(ActionStore.prototype, 'inner');
decorate(ActionStore.prototype, 'outer');
const counted = store => {
    let emits = 0, deliveries = 0;
    const original = store.emitUpdate;
    store.emitUpdate = function (...args) { emits++; return original.apply(this, args); };
    store.subscribe(() => deliveries++);
    return {metrics: () => ({emits, deliveries})};
};
const exercise = (store, run) => {
    const counts = counted(store);
    run(store);
    return counts.metrics();
};
const actionStore = new ActionStore();
// Warm update and action methods before measuring constructor counts.
actionStore.update(increment, 1);
actionStore.single(); actionStore.outer();
const singleMetrics = exercise(new ActionStore(), store => store.single());
const nestedMetrics = exercise(new ActionStore(), store => store.outer());
const singleBaselineMetrics = exercise(new ActionStore(), store => store.update(increment, 1));
const nestedBaselineMetrics = exercise(new ActionStore(), store => store.update(increment, 2));
const positiveControlMetrics = exercise(new ActionStore(), store => {
    store.update(increment, 1);
    store.update(increment, 1);
});
const constructors = fn => {
    const originals = {
        Set: globalThis.Set,
        Map: globalThis.Map,
        WeakMap: globalThis.WeakMap,
        WeakSet: globalThis.WeakSet,
    };
    const counts = {sets: 0, maps: 0, weakMaps: 0, weakSets: 0};
    const fields = {Set: 'sets', Map: 'maps', WeakMap: 'weakMaps', WeakSet: 'weakSets'};
    for (const name of Object.keys(originals)) globalThis[name] = new Proxy(originals[name], {
        construct(target, args, newTarget) {
            counts[fields[name]]++;
            return Reflect.construct(target, args, newTarget);
        },
    });
    try { fn(); } finally { for (const name of Object.keys(originals)) globalThis[name] = originals[name]; }
    return counts;
};
const allocationCount = run => {
    const store = new ActionStore();
    store.single(); store.outer();
    return constructors(() => run(store));
};
const singleActionAllocations = allocationCount(store => store.single());
const nestedActionAllocations = allocationCount(store => store.outer());
const singleUpdateAllocations = allocationCount(store => store.update(increment, 1));
const nestedUpdateAllocations = allocationCount(store => store.update(increment, 2));
const positiveAllocations = allocationCount(store => {
    store.update(increment, 1);
    store.update(increment, 1);
});
const constructorControl = constructors(() => { new Set(); new Map(); });
const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0);
emit({singleActionEmits: singleMetrics.emits, singleActionDeliveries: singleMetrics.deliveries,
    nestedActionEmits: nestedMetrics.emits, nestedActionDeliveries: nestedMetrics.deliveries,
    singleBaselineEmits: singleBaselineMetrics.emits, singleBaselineDeliveries: singleBaselineMetrics.deliveries,
    nestedBaselineEmits: nestedBaselineMetrics.emits, nestedBaselineDeliveries: nestedBaselineMetrics.deliveries,
    positiveControlEmits: positiveControlMetrics.emits, positiveControlDeliveries: positiveControlMetrics.deliveries,
    singleActionCollections: sum(singleActionAllocations), singleUpdateCollections: sum(singleUpdateAllocations),
    nestedActionCollections: sum(nestedActionAllocations), nestedUpdateCollections: sum(nestedUpdateAllocations),
    positiveControlCollections: sum(positiveAllocations), constructorControlCollections: sum(constructorControl),
    allocationNote: 'Counts Set/Map/WeakMap/WeakSet constructors only; not all JavaScript allocations.'});
