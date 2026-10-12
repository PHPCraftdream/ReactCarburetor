import assert from 'node:assert/strict';
import {emit, load, median} from '../../harness/lib.mjs';
import {graph} from './graph.mjs';

const {Carburetor, computed} = await load();
const store = new Carburetor({tick: 0});
let bodies = 0;
let deliveries = 0;
const value = computed(read => { bodies++; void read(store).tick; return 1; });
const id = value.subscribe(() => { deliveries++; });
let emptyBodies = 0;
const empty = computed(() => { emptyBodies++; return 1; });
const emptyId = empty.subscribe(() => { throw new Error('empty delivery'); });
const constructors = body => {
    const NativeMap = globalThis.Map;
    const NativeSet = globalThis.Set;
    let maps = 0;
    let sets = 0;
    globalThis.Map = new Proxy(NativeMap, {construct(target, args, next) {
        maps++;
        return Reflect.construct(target, args, next);
    }});
    globalThis.Set = new Proxy(NativeSet, {construct(target, args, next) {
        sets++;
        return Reflect.construct(target, args, next);
    }});
    try { body(); return {maps, sets}; }
    finally { globalThis.Map = NativeMap; globalThis.Set = NativeSet; }
};
try {
    assert.equal(value.get(), 1);
    assert.equal(empty.get(), 1);
    const positive = constructors(() => { new Map(); new Set(); });
    const overBudget = constructors(() => {
        for (let i = 0; i < 2; i++) new Map();
        for (let i = 0; i < 4; i++) new Set();
    });
    const overBudgetMapsRejected = overBudget.maps > 1;
    const overBudgetSetsRejected = overBudget.sets > 3;
    assert.deepEqual(positive, {maps: 1, sets: 1});
    assert.deepEqual(overBudget, {maps: 2, sets: 4});
    assert.equal(overBudgetMapsRejected, true);
    assert.equal(overBudgetSetsRejected, true);
    const emptyWindow = constructors(() => {});
    const cached = constructors(() => {
        for (let i = 0; i < 64; i++) { value.get(); empty.get(); }
    });
    const equalTick = constructors(() => { store.update(draft => { draft.tick++; }); value.get(); });
    assert.deepEqual(emptyWindow, {maps: 0, sets: 0});
    assert.deepEqual(cached, {maps: 0, sets: 0});
    assert.equal(value.get(), 1);
    assert.equal(store.getData().tick, 1);
    assert.equal(bodies, 2);
    assert.equal(emptyBodies, 1);
    assert.equal(deliveries, 0);
    const tiny = graph(1, 4, 'distinct');
    let tinyConstruction;
    try {
        tinyConstruction = constructors(() => tiny.bump());
        assert.equal(tiny.top.get(), tiny.initial + 1);
        assert.deepEqual(tiny.events, [tiny.initial + 1]);
        assert.equal(tiny.counts().groupRuns, 1);
    } finally { tiny.close(); }
    const wide = graph(64, 4, 'distinct');
    let wideConstruction;
    try {
        wideConstruction = constructors(() => wide.bump());
        assert.equal(wide.top.get(), wide.initial + 1);
        assert.deepEqual(wide.events, [wide.initial + 1]);
    } finally { wide.close(); }
    const single = graph(1, 4, 'bare-first');
    let singleConstruction;
    try {
        singleConstruction = constructors(() => single.bump());
        assert.equal(single.top.get(), single.initial + 1);
        assert.deepEqual(single.events, [single.initial + 1]);
    } finally { single.close(); }
    const noCollisionConstructors = wideConstruction.maps <= tinyConstruction.maps + 63
        && wideConstruction.sets <= tinyConstruction.sets + 63;
    const singleCollisionConstructors = singleConstruction.maps <= tinyConstruction.maps + 2
        && singleConstruction.sets <= tinyConstruction.sets + 2;
    const tickSamples = [];
    const emptySamples = [];
    for (let round = 0; round < 7; round++) {
        let start = performance.now();
        for (let i = 0; i < 16; i++) {
            store.update(draft => { draft.tick++; });
            assert.equal(value.get(), 1);
        }
        tickSamples.push((performance.now() - start) / 16);
        start = performance.now();
        for (let i = 0; i < 16; i++) assert.equal(empty.get(), 1);
        emptySamples.push((performance.now() - start) / 16);
    }
    emit({positiveMaps: positive.maps, positiveSets: positive.sets,
        overBudgetMaps: overBudget.maps, overBudgetSets: overBudget.sets,
        overBudgetMapsRejected, overBudgetSetsRejected,
        emptyMaps: emptyWindow.maps, emptySets: emptyWindow.sets,
        cachedMaps: cached.maps, cachedSets: cached.sets,
        equalTickMaps: equalTick.maps, equalTickSets: equalTick.sets,
        tinyMaps: tinyConstruction.maps, tinySets: tinyConstruction.sets,
        wideMaps: wideConstruction.maps, wideSets: wideConstruction.sets,
        singleMaps: singleConstruction.maps, singleSets: singleConstruction.sets,
        noCollisionConstructors, singleCollisionConstructors,
        bodies, emptyBodies, deliveries, ticks: 113, tinyCorrect: true,
        equalTickMs: median(tickSamples), emptyGetMs: median(emptySamples),
        constructorUnit: 'actual global Map/Set constructor calls in synchronous work window',
        timingUnit: 'milliseconds per uninstrumented completed operation', done: true});
} finally { value.unsubscribe(id); empty.unsubscribe(emptyId); }
