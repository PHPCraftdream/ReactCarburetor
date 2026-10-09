/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R31-02: settled readonly `forgetAll` prepares one bulk removal instead of N whole-graph clones;
// Controls carry only the writable/mixed removal fallbacks.
// Args: [count=32] [op=settled|writable|mixed|controls]
import {emit, loadPath, median, call} from '../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {EResourceStatus} = await loadPath('Carburetor/Models/Enums/EResourceStatus.mjs');

const count = Number(process.argv[2] ?? 32);
const op = process.argv[3] ?? 'settled';

const ready = rowId => ({
    status: EResourceStatus.Success,
    data: {rowId, detail: {value: rowId}},
    error: undefined,
    updatedAt: 1,
    refreshing: false,
    invalidated: false,
    failed: false,
});

const prepare = (operation, size) => {
    const cache = new ResourceCache(key => Promise.resolve({key}), {ttl: Infinity, maxEntries: Infinity});
    const entries = Object.create(null);
    for (let index = 0; index < size; index++) {
        const key = call(cache, 'keyOf', `row-${index}`);
        const locked = operation !== 'writable' && !(operation === 'mixed' && index === 0);
        Object.defineProperty(entries, key, {
            value: ready(index), enumerable: true, writable: true, configurable: !locked,
        });
    }
    cache.setData({entries});
    const active = operation === 'mixed' ? cache.refresh('row-0') : undefined;
    let subscriberCalls = 0;
    const subscription = cache.subscribe(() => { subscriberCalls++; });
    return {
        cache, active, subscription,
        subscriberCalls: () => subscriberCalls,
        settle: () => {
            if (active) void active.catch(() => undefined);
            cache.unsubscribe(subscription);
        },
    };
};

const instrumented = operation => {
    const state = prepare(operation, count);
    const version = state.cache.getVersion();
    const originalOwnKeys = Reflect.ownKeys;
    let roots = 0;
    let entryVisits = 0;
    let rowVisits = 0;
    Reflect.ownKeys = target => {
        if (Object.hasOwn(target, 'entries')) roots++;
        if (Object.hasOwn(target, 'status') && Object.hasOwn(target, 'data')) entryVisits++;
        if (Object.hasOwn(target, 'rowId')) rowVisits++;
        return originalOwnKeys(target);
    };
    try {
        state.cache.forgetAll();
    } finally {
        Reflect.ownKeys = originalOwnKeys;
    }
    state.settle();
    return {
        roots,
        entryVisits,
        rowVisits,
        publicationDelta: state.cache.getVersion() - version,
        remainingEntries: Object.keys(state.cache.getData().entries).length,
        subscriberCalls: state.subscriberCalls(),
    };
};

const timed = (operation, samples) => {
    const times = [];
    for (let sample = 0; sample < samples; sample++) {
        const state = prepare(operation, count);
        const started = performance.now();
        state.cache.forgetAll();
        times.push(performance.now() - started);
        state.settle();
    }
    return median(times);
};

if (op === 'controls') {
    const writable = instrumented('writable');
    const forgetMsWritable = timed('writable', 3);
    const mixed = instrumented('mixed');
    const forgetMsMixed = timed('mixed', 3);
    emit({
        publicationWritable: writable.publicationDelta, remainingWritable: writable.remainingEntries,
        rootsWritable: writable.roots, forgetMsWritable,
        publicationMixed: mixed.publicationDelta, remainingMixed: mixed.remainingEntries,
        rootsMixed: mixed.roots, visitsMixed: mixed.entryVisits, forgetMsMixed,
    });
} else {
    const metrics = instrumented(op);
    emit({...metrics, removeMs: timed(op, 5)});
}
