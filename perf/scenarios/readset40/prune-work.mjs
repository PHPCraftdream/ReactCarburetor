/* oxlint-disable carburetor-internal/require-tsdoc */
import {emit, loadPath, median} from '../../harness/lib.mjs';
const {completeReads} = await loadPath('Carburetor/Store/Tracking/Observation/completeReads.mjs');
const shapes = [
    ['presence', ['user.~p']],
    ['pair', ['user.~p', 'user.name']],
    ['hook', ['items.~p', 'items.r0.~p', 'items.r0.title']],
    ['four', ['items.~p', 'items.r0.~p', 'items.r0.title', 'user.~p']],
    ['class', ['items.~p', 'items.r0.~p', 'items.r0.title', 'items.r0.owner.~p', 'items.r0.owner.name']],
    ['active', ['items.~p', 'items.~k', ...Array.from({length: 1000}, (_, i) =>
        [`items.r${i}.~p`, `items.r${i}.done`]).flat()]],
];
const NativeSet = globalThis.Set;
const metrics = {};
let correct = true;
for (const [name, paths] of shapes) {
    const expected = paths.filter(path => !path.endsWith('.~p') || !paths.some(other =>
        other !== path && other.startsWith(path.slice(0, -2))));
    const batches = Array.from({length: 7}, () =>
        Array.from({length: name === 'active' ? 100 : 10000}, () => new NativeSet(paths)));
    const samples = [];
    for (const batch of batches) {
        const start = performance.now();
        for (const reads of batch) completeReads(reads);
        samples.push((performance.now() - start) * 1000 / batch.length);
        correct &&= batch.every(reads => reads.size === expected.length && expected.every(path => reads.has(path)));
    }
    let sets = 0;
    const scratch = new NativeSet(paths);
    globalThis.Set = class extends NativeSet { constructor(...args) { super(...args); sets++; } };
    try { completeReads(scratch); } finally { globalThis.Set = NativeSet; }
    metrics[name + 'Us'] = median(samples);
    metrics[name + 'SamplesUs'] = samples;
    metrics[name + 'Sets'] = sets;
    metrics[name + 'Paths'] = scratch.size;
}
const {presenceUs, pairUs, hookUs, fourUs, classUs, activeUs,
    presenceSets, pairSets, hookSets, fourSets, classSets, activeSets,
    presencePaths, pairPaths, hookPaths, fourPaths, classPaths, activePaths} = metrics;
emit({presenceUs, pairUs, hookUs, fourUs, classUs, activeUs,
    presenceSets, pairSets, hookSets, fourSets, classSets, activeSets,
    presencePaths, pairPaths, hookPaths, fourPaths, classPaths, activePaths, correct, ...metrics});
