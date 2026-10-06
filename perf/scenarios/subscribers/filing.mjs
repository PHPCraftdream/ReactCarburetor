/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-09: filing three-path subscribers, then removing them; after a full cycle nothing may stay
// filed, and filing itself allocates no ancestors array per path. Args: [subscribers=4000] [reps=5]
import {emit, loadPath} from '../../harness/lib.mjs';

const {SubscriberIndex} = await loadPath('Carburetor/Store/Paths/SubscriberIndex.mjs');

const subscribers = Number(process.argv[2] ?? 4000);
const reps = Number(process.argv[3] ?? 5);

// Built once, outside timing: three read paths per subscriber.
const readSets = Array.from({length: subscribers}, (_, n) => new Set([`rows.${n}`, `rows.${n}.title`, `rows.${n}.done`]));
const ids = Array.from({length: subscribers}, (_, n) => `sub-${n}`);

global.gc?.();
let fileMs = Infinity;
let unfileMs = Infinity;
for (let i = 0; i < reps; i++) {
    const index = new SubscriberIndex();
    let start = process.hrtime.bigint();
    for (let n = 0; n < subscribers; n++) index.add(ids[n], readSets[n]);
    const filing = Number(process.hrtime.bigint() - start) / 1e6;
    if (filing < fileMs) fileMs = filing;
    // Removal timed immediately after filing in the same repetition.
    start = process.hrtime.bigint();
    for (let n = 0; n < subscribers; n++) index.remove(ids[n]);
    const removing = Number(process.hrtime.bigint() - start) / 1e6;
    if (removing < unfileMs) unfileMs = removing;
}

// Mechanism (R30-09): the pre-fix index allocated an ancestors array per filed path and walked it
// with Array.prototype.forEach; the in-place walk does neither. Self-check: the same wrapper must
// count a deliberately run array forEach, or the probe has gone blind.
let ancestorArrayWalks = 0;
let probeSelfCount = 0;
{
    const originalForEach = Array.prototype.forEach;
    Array.prototype.forEach = function (...args) {
        if (Array.isArray(this)) ancestorArrayWalks++;
        return originalForEach.apply(this, args);
    };
    try {
        const index = new SubscriberIndex();
        for (let n = 0; n < subscribers; n++) index.add(ids[n], readSets[n]);
        const engineWalks = ancestorArrayWalks;
        [0, 1, 2].forEach(() => undefined);
        probeSelfCount = ancestorArrayWalks - engineWalks;
        ancestorArrayWalks = engineWalks;
    } finally {
        Array.prototype.forEach = originalForEach;
    }
}

// Correctness: a write at a filed path wakes exactly its subscriber, an ancestor write wakes every
// subscriber reading below it, every filed path answers hasReaderAt, and after removal nothing stays.
const step = Math.max(1, subscribers >> 3);
const check = new SubscriberIndex();
for (let n = 0; n < subscribers; n++) check.add(ids[n], readSets[n]);
let wakesExact = true;
let filedOk = true;
for (let n = 0; n < subscribers; n += step) {
    const matched = check.match(new Set([`rows.${n}.title`]));
    wakesExact &&= matched.size === 1 && matched.has(ids[n]);
    filedOk &&= check.hasReaderAt(`rows.${n}`) && check.hasReaderAt(`rows.${n}.title`) && check.hasReaderAt(`rows.${n}.done`);
}
const wakesAncestor = check.match(new Set(['rows'])).size === subscribers;
for (let n = 0; n < subscribers; n++) check.remove(ids[n]);
const leftovers = check.hasReaderAt('rows.0.title')
    || check.match(new Set(['rows.0.title'])).size > 0
    || check.match(new Set(['rows'])).size > 0;

emit({fileMs, unfileMs, ancestorArrayWalks, probeSelfCount, wakesExact, wakesAncestor, filedOk, leftovers});
