/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Resource views contract: `setData` keeps unchanged entry views identical, publishes once for a
// real change and nothing for the same root (round 10 measurement plan). Args: [count=100]
import {emit, loadPath, median} from '../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {EResourceStatus} = await loadPath('Carburetor/Models/Enums/EResourceStatus.mjs');

const count = Number(process.argv[2] ?? 100);
const ready = index => ({
    status: EResourceStatus.Success,
    data: {index},
    error: undefined,
    updatedAt: 1,
    refreshing: false,
    invalidated: false,
    failed: false,
});

const measure = mode => {
    const cache = new ResourceCache(() => Promise.resolve(undefined), {ttl: Infinity, maxEntries: Infinity});
    const keys = Array.from({length: count}, (_, index) => cache.keyOf(index));
    const entries = Object.fromEntries(keys.map((key, index) => [key, ready(index)]));
    cache.setData({entries});
    const previous = keys.map(key => cache.getEntryByKey(key));
    const replacement = () => mode === 'same-root'
        ? cache.getData()
        : mode === 'new-root'
            ? {entries}
            : {entries: {...entries, [keys[0]]: {...entries[keys[0]], data: {index: -1}}}};
    const replacementTimes = [];
    const readTimes = [];
    let changed = 0;
    let versionDelta = 0;
    let value0 = 0;
    for (let sample = 0; sample < 5; sample++) {
        const next = replacement();
        const version = cache.getVersion();
        const started = performance.now();
        cache.setData(next);
        const afterReplacement = performance.now();
        const views = keys.map(key => cache.getEntryByKey(key));
        readTimes.push(performance.now() - afterReplacement);
        replacementTimes.push(afterReplacement - started);
        if (sample === 0) {
            changed = views.filter((view, index) => view !== previous[index]).length;
            versionDelta = cache.getVersion() - version;
            value0 = views[0].data.index;
        }
    }
    return {changed, versionDelta, value0, replacementMs: median(replacementTimes), readMs: median(readTimes)};
};

const same = measure('same-root');
const fresh = measure('new-root');
const one = measure('one-changed');
emit({
    sameRootChanged: same.changed, versionDeltaSame: same.versionDelta, value0Same: same.value0,
    replacementMsSame: same.replacementMs, readMsSame: same.readMs,
    newRootChanged: fresh.changed, versionDeltaNew: fresh.versionDelta, value0New: fresh.value0,
    replacementMsNew: fresh.replacementMs, readMsNew: fresh.readMs,
    oneChangedChanged: one.changed, versionDeltaOne: one.versionDelta, value0OneChanged: one.value0,
    replacementMsOne: one.replacementMs, readMsOne: one.readMs,
});
