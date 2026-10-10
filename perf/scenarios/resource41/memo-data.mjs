/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {call, emit, engine, load, loadPath, setupReact} from '../../harness/lib.mjs';

const {ResourceCache, AntiHookComponent} = await load();
const {useResourceValue} = await load('Interop');
if (typeof useResourceValue !== 'function') throw new Error('R41 requires public useResourceValue; no substitute consumer');
const {React, flushSync, root, container} = await setupReact();
const drain = async () => { await new Promise(resolve => setTimeout(resolve, 20)); flushSync(() => {}); };
const run = async kind => {
    let name = 'Ada';
    let renders = 0;
    let parents = 0;
    let retained;
    let rendering = false;
    let loadsInRender = 0;
    const cache = new ResourceCache(async () => {
        if (rendering) loadsInRender++;
        return {nested: {name, unread: 0}};
    }, {ttl: Infinity});
    await cache.load('user');
    const key = cache.resolve('user').key;
    let selectorCalls = 0;
    let adds = 0;
    let removes = 0;
    const subscribe = cache.subscribe.bind(cache);
    const unsubscribe = cache.unsubscribe.bind(cache);
    cache.subscribe = (...args) => { adds++; return subscribe(...args); };
    cache.unsubscribe = (...args) => { removes++; return unsubscribe(...args); };
    const select = view => { selectorCalls++; return {nested: {name: view.data.nested.name}}; };
    const Child = React.memo(({data}) => {
        // oxlint-disable-next-line react/immutability -- Intentional count of real React memo-child renders.
        renders++;
        return React.createElement('span', null, data.nested.name);
    });
    const Hook = ({tick}) => {
        void tick;
        // oxlint-disable-next-line react/immutability -- Intentional count of real hook parent renders.
        parents++;
        // oxlint-disable-next-line react/immutability -- Loader guard measures whether loads happen during render.
        rendering = true;
        try {
            const data = useResourceValue(cache, 'user', kind === 'inline' ? view => select(view) : select);
            // oxlint-disable-next-line react/immutability -- Retain the first detached selection.
            retained ??= data;
            return React.createElement(Child, {data});
        } finally {
            // oxlint-disable-next-line react/immutability -- Close the loader instrumentation window even on render failure.
            rendering = false;
        }
    };
    class Control extends AntiHookComponent {
        render() {
            // oxlint-disable-next-line react/immutability -- Positive-control parent render counter, not UI state.
            parents++;
            return React.createElement(Child, {data: this.useResource(cache, 'user').data});
        }
    }
    class SelectionControl extends AntiHookComponent {
        selected = this.connectSelection(cache, view => ({nested: {name: view.entries[key].data.nested.name}}));
        render() {
            // oxlint-disable-next-line react/immutability -- Count actual class-selection parent renders.
            parents++;
            this.useResource(cache, 'user');
            const data = this.selected();
            // oxlint-disable-next-line react/immutability -- Retain the first class-selection snapshot.
            retained ??= data;
            return React.createElement(Child, {data});
        }
    }
    const Parent = kind === 'class' ? Control : kind === 'selection' ? SelectionControl : Hook;
    const mount = tick => flushSync(() => root.render(React.createElement(Parent, {tick})));
    mount(0);
    mount(1);
    const unrelated = renders;
    const definitions = Object.defineProperty;
    const Weak = globalThis.WeakMap;
    let accessors = 0;
    let trees = 0;
    Object.defineProperty = (target, key, descriptor) => {
        if ((descriptor.get || descriptor.set)
            && ['status', 'data', 'error', 'updatedAt', 'refreshing', 'invalidated', 'failed', 'stale'].includes(key)) accessors++;
        return definitions(target, key, descriptor);
    };
    globalThis.WeakMap = class extends Weak { constructor(...args) { super(...args); trees++; } };
    const callsBefore = selectorCalls;
    const addsBefore = adds;
    const removesBefore = removes;
    let checksum = 0;
    try {
        for (let tick = 2; tick < 1002; tick++) {
            mount(tick);
            checksum += container.textContent === 'Ada' ? 1 : 0;
        }
    }
    finally { Object.defineProperty = definitions; globalThis.WeakMap = Weak; }
    const stableCalls = selectorCalls - callsBefore;
    const stableAdds = adds - addsBefore;
    const stableRemoves = removes - removesBefore;
    const stable = renders;
    const beforeUnread = parents;
    if (kind !== 'class') {
        flushSync(() => call(cache, 'update', draft => { draft.entries[key].data.nested.unread = 1; }));
    }
    await drain();
    const unreadParents = parents - beforeUnread;
    const unreadChildren = renders - stable;
    const beforeLeafParents = parents;
    const beforeLeafChildren = renders;
    const beforeLeafCalls = selectorCalls;
    let reevaluationWeakMaps = 0;
    globalThis.WeakMap = class extends Weak { constructor(...args) { super(...args); reevaluationWeakMaps++; } };
    try {
        if (kind !== 'class') {
            flushSync(() => call(cache, 'update', draft => { draft.entries[key].data.nested.name = 'Leaf'; }));
        }
        await drain();
    } finally { globalThis.WeakMap = Weak; }
    const reevaluationSelectorCalls = selectorCalls - beforeLeafCalls;
    const leafParentDeliveries = parents - beforeLeafParents;
    const leafChildDeliveries = renders - beforeLeafChildren;
    const leafText = container.textContent;
    name = 'Grace';
    await cache.refresh('user');
    await drain();
    const refreshed = renders;
    const text = container.textContent;
    const captured = retained?.nested.name;
    let localOverrideText;
    if (kind === 'hook' || kind === 'inline') {
        const Override = () => {
            const data = useResourceValue(cache, 'user', select);
            const local = {...data, nested: {...data.nested, name: 'local'}};
            return React.createElement('span', null, local.nested.name);
        };
        flushSync(() => root.render(React.createElement(Override)));
        localOverrideText = container.textContent;
    }
    const localOverrideCacheText = cache.getEntry('user').data.nested.name;
    flushSync(() => root.render(null));
    const ownersAfterUnmount = engine(cache, 'targetOwners').count;
    return {unrelated, stable, refreshed, text, accessors, trees, parents,
        ownersAfterUnmount, reevaluationWeakMaps, reevaluationSelectorCalls,
        stableCalls, stableAdds, stableRemoves, checksum, adds, removes,
        unreadParents, unreadChildren, captured, loadsInRender,
        leafParentDeliveries, leafChildDeliveries, leafText, localOverrideText, localOverrideCacheText};
};
const {createResourceReader} = await loadPath('Interop/createResourceReader.mjs');
const allocationLane = async kind => {
    const cache = new ResourceCache(async () => ({object: {name: 'Ada'}, array: ['Ada'], graph: {nested: {name: 'Ada'}}}), {ttl: Infinity});
    await cache.load('user');
    const key = cache.resolve('user').key;
    const reader = createResourceReader(cache, cache.resolve('user').path);
    let calls = 0;
    const select = view => {
        calls++;
        if (kind === 'directflatobject') return view.data.object;
        if (kind === 'directflatarray') return view.data.array;
        if (kind === 'constructedflatobject') return {name: view.data.object.name};
        if (kind === 'constructedflatarray') return [view.data.array[0]];
        return view.data.graph;
    };
    const NativeSet = globalThis.Set;
    const NativeWeakMap = globalThis.WeakMap;
    const measure = () => {
        const resolution = cache.resolve('user');
        const counts = {sets: 0, setCopies: 0, weakMaps: 0};
        globalThis.Set = class extends NativeSet {
            constructor(...args) {
                super(...args);
                counts.sets++;
                if (args[0] instanceof NativeSet) counts.setCopies++;
            }
        };
        globalThis.WeakMap = class extends NativeWeakMap {
            constructor(...args) { super(...args); counts.weakMaps++; }
        };
        let observation;
        try { observation = reader.evaluate('user', resolution, select); }
        finally { globalThis.Set = NativeSet; globalThis.WeakMap = NativeWeakMap; }
        return {counts, observation};
    };
    const first = measure();
    let last = first;
    const totals = {sets: 0, setCopies: 0, weakMaps: 0};
    for (let index = 0; index < 32; index++) {
        call(cache, 'update', draft => {
            draft.entries[key].data.object.name = String(index);
            draft.entries[key].data.array[0] = String(index);
            draft.entries[key].data.graph.nested.name = String(index);
        });
        last = measure();
        for (const metric of Object.keys(totals)) totals[metric] += last.counts[metric];
    }
    const value = last.observation.value;
    return {first: first.counts, totals, calls,
        text: kind === 'graph' ? value.nested.name : kind.endsWith('array') ? value[0] : value.name,
        retained: kind === 'graph' ? first.observation.value.nested.name
            : kind.endsWith('array') ? first.observation.value[0] : first.observation.value.name,
        selectorFootprint: last.observation.selectorReads !== undefined
            && last.observation.selectorReads.size < last.observation.reads.size,
        ledger: last.observation.copies !== undefined};
};
const allocations = {};
for (const kind of ['directflatobject', 'directflatarray', 'constructedflatobject', 'constructedflatarray', 'graph']) {
    allocations[kind] = await allocationLane(kind);
}
const directFlatAllocationControl = ['object', 'array'].every(shape => {
    const direct = allocations['directflat' + shape];
    const constructed = allocations['constructedflat' + shape];
    return direct.first.setCopies === 0 && direct.totals.setCopies === 0
        && direct.first.sets === constructed.first.sets && direct.totals.sets === constructed.totals.sets
        && direct.first.weakMaps === constructed.first.weakMaps && direct.totals.weakMaps === constructed.totals.weakMaps
        && !direct.ledger && !direct.selectorFootprint;
});
const graphAllocationControl = allocations.graph.first.sets > allocations.directflatobject.first.sets
    && allocations.graph.totals.sets > allocations.directflatobject.totals.sets
    && allocations.graph.first.weakMaps > allocations.directflatobject.first.weakMaps
    && allocations.graph.totals.weakMaps > allocations.directflatobject.totals.weakMaps
    && allocations.graph.ledger && allocations.graph.selectorFootprint;
const allocationCaptureControl = Object.values(allocations).every(lane => lane.calls === 33 && lane.text === '31' && lane.retained === 'Ada');
const control = await run('class');
const selection = await run('selection');
const hook = await run('hook');
const inline = await run('inline');
flushSync(() => root.unmount());
emit({
    allocations, directFlatAllocationControl, graphAllocationControl, allocationCaptureControl,
    directFlatObjectReevaluationSets: allocations.directflatobject.totals.sets,
    directFlatArrayReevaluationSets: allocations.directflatarray.totals.sets,
    directFlatObjectReevaluationSetCopies: allocations.directflatobject.totals.setCopies,
    directFlatArrayReevaluationSetCopies: allocations.directflatarray.totals.setCopies,
    hookUnrelated: hook.unrelated, hookStable: hook.stable, hookRefresh: hook.refreshed,
    hookText: hook.text, hookAttempts: hook.parents,
    accessorDefinitions: hook.accessors, readTreeWeakMaps: hook.trees,
    hookUnreadParents: hook.unreadParents, hookUnreadChildren: hook.unreadChildren,
    capturedText: hook.captured, loadsInRender: hook.loadsInRender,
    leafParentDeliveries: hook.leafParentDeliveries, leafChildDeliveries: hook.leafChildDeliveries,
    leafText: hook.leafText, localOverrideText: hook.localOverrideText,
    localOverrideCacheText: hook.localOverrideCacheText,
    classUnrelated: control.unrelated, classStable: control.stable,
    classRefresh: control.refreshed, classText: control.text,
    classUnreadParents: control.unreadParents, classUnreadChildren: control.unreadChildren,
    classLeafParentDeliveries: control.leafParentDeliveries,
    classLeafChildDeliveries: control.leafChildDeliveries, classLeafText: control.leafText,
    ownersAfterUnmount: hook.ownersAfterUnmount,
    reevaluationSelectorCalls: hook.reevaluationSelectorCalls, reevaluationWeakMaps: hook.reevaluationWeakMaps,
    stableSelectorCalls: hook.stableCalls, stableSubscriptionAdds: hook.stableAdds,
    stableSubscriptionRemoves: hook.stableRemoves, stableChecksum: hook.checksum,
    subscriptionsBalanced: hook.adds === hook.removes,
    inlineSelectorCalls: inline.stableCalls, inlineWeakMaps: inline.trees,
    inlineAccessors: inline.accessors, inlineChecksum: inline.checksum, inlineStable: inline.stable,
    selectionUnreadParents: selection.unreadParents, selectionUnreadChildren: selection.unreadChildren,
    selectionLeafParentDeliveries: selection.leafParentDeliveries,
    selectionLeafChildDeliveries: selection.leafChildDeliveries, selectionLeafText: selection.leafText,
    selectionText: selection.text,
    done: hook.text === 'Grace' && control.text === 'Grace' && selection.text === 'Grace' && inline.text === 'Grace',
});
