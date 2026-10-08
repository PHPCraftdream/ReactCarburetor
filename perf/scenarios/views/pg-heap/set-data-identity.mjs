/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R10-06: count public view identities for root and single-answer replacements; no private cache fields.
import {emit, loadPath} from '../../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');
const {EResourceStatus} = await loadPath('Carburetor/Models/Enums/EResourceStatus.mjs');
const count = Number(process.argv[2] ?? 4000);
const ready = index => ({
    status: EResourceStatus.Success, data: {index}, error: undefined, updatedAt: 1,
    refreshing: false, invalidated: false, failed: false,
});
const cache = new ResourceCache(() => Promise.resolve(undefined), {ttl: Infinity, maxEntries: Infinity});
const keys = Array.from({length: count}, (_, index) => cache.keyOf(index));
const entries = Object.fromEntries(keys.map((key, index) => [key, ready(index)]));
cache.setData({entries});
const read = () => keys.map(key => cache.getEntryByKey(key));
const changed = (before, after) => after.filter((view, index) => view !== before[index]).length;
const initial = read();
const idleNewViews = changed(initial, read());
const beforeVersion = cache.getVersion();
const started = performance.now();
cache.setData({entries});
const replacementMs = performance.now() - started;
const after = read();
const newViews = changed(initial, after);
const versionDeltaNew = cache.getVersion() - beforeVersion;
const unchangedCorrect = after.every((view, index) => view.data.index === index && view.status === EResourceStatus.Success);
// Replace one answer; all other entries retain their original inputs.
const singleVersion = cache.getVersion();
cache.setData({entries: {...entries, [keys[0]]: ready(count)}});
const single = read();
const singleNewViews = changed(after, single);
const singleSameViews = single.slice(1).filter((view, index) => view === after[index + 1]).length;
const singleChangedView = single[0] !== after[0];
const singleVersionDelta = cache.getVersion() - singleVersion;
const singleCorrect = single.every((view, index) => view.data.index === (index === 0 ? count : index)
    && view.status === EResourceStatus.Success);
// Changing every answer proves that an identity probe cannot silently stay at zero.
const positiveVersion = cache.getVersion();
cache.setData({entries: Object.fromEntries(keys.map((key, index) => [key, ready(-index - 1)]))});
const positive = read();
const positiveNewViews = changed(single, positive);
const positiveVersionDelta = cache.getVersion() - positiveVersion;
const positiveCorrect = positive.every((view, index) => view.data.index === -index - 1);
const repeatNewViews = changed(positive, read());
emit({
    newViews, idleNewViews, singleNewViews, singleSameViews, singleChangedView, positiveNewViews, repeatNewViews,
    versionDeltaNew, singleVersionDelta, positiveVersionDelta, replacementMs,
    done: unchangedCorrect && singleCorrect && positiveCorrect && initial.every((view, index) => view.data.index === index),
});
