// Paired A/B benchmark of subscriber filing (R30-09).
// BASELINE_DIST=/path/to/baseline/dist AFTER_DIST=/path/to/fixed/dist \
//   node benchmarks/state/tracking/consumers/subscriberFiling.mjs
// Gate: subscribing 4000 three-path subscribers must cost <= 0.8x the baseline,
// with matching results identical on both sides (correctness differential).

import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (!process.env.BASELINE_DIST) {
    throw new Error('Set BASELINE_DIST to a built baseline distribution; AFTER_DIST defaults to ./dist');
}

const variant = process.env.DIST_VARIANT ?? 'esm-prod';
const load = async (root, file) => import(pathToFileURL(resolve(root, file)).href);
const roots = {
    baseline: resolve(process.env.BASELINE_DIST),
    fixed: resolve(process.env.AFTER_DIST ?? 'dist'),
};
const implementations = Object.fromEntries(await Promise.all(Object.entries(roots).map(async ([name, root]) => {
    const module = await load(root, `${variant}/Carburetor/Store/Paths/SubscriberIndex.mjs`);

    return [name, module.SubscriberIndex];
})));

const samples = 15;
const subscribers = 4000;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = {baseline: [], fixed: []};
const ratios = [];
const readsFor = (index) => new Set([
    `rows.${index}`,
    `rows.${index}.title`,
    `rows.${index}.done`,
]);

// Built once: the measurement times filing, not Set construction.
const readSets = Array.from({length: subscribers}, (_, n) => readsFor(n));
const ids = Array.from({length: subscribers}, (_, n) => `sub-${n}`);

/** Milliseconds to file and then unfile every subscriber — the best of 5 repetitions, since a
 * minimum is robust against bursts of background load from other processes on this machine.
 *
 * @param SubscriberIndex - the built index class under measurement
 */
function measure(SubscriberIndex) {
    let best = Infinity;
    let bestUnfile = Infinity;

    for (let repetition = 0; repetition < 5; repetition++) {
        const index = new SubscriberIndex();
        const start = process.hrtime.bigint();

        for (let n = 0; n < subscribers; n++) index.add(ids[n], readSets[n]);

        const filedMs = Number(process.hrtime.bigint() - start) / 1e6;

        if (filedMs < best) best = filedMs;

        const startUnfile = process.hrtime.bigint();

        for (let n = 0; n < subscribers; n++) index.remove(ids[n]);

        const unfiledMs = Number(process.hrtime.bigint() - startUnfile) / 1e6;

        if (unfiledMs < bestUnfile) bestUnfile = unfiledMs;
    }

    if (globalThis.gc) globalThis.gc();

    // Correctness differential: after a full add/remove cycle nothing may remain filed.
    const check = new SubscriberIndex();

    for (let n = 0; n < subscribers; n++) check.add(ids[n], readSets[n]);
    for (let n = 0; n < subscribers; n++) check.remove(ids[n]);

    if (check.hasReaderAt('rows.0.title')) throw new Error('unfile left readers behind');

    return {filedMs: best, unfiledMs: bestUnfile};
}

const perRound = {};

for (let round = -2; round < samples; round++) {
    // A full collection between rounds keeps the previous round's index garbage from
    // leaking into the next side's file measurement.
    globalThis.gc?.();

    const order = round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline'];

    for (const side of order) {
        const {filedMs, unfiledMs} = measure(implementations[side]);

        if (round >= 0) {
            results[side].push({filedMs, unfiledMs});
            perRound[side] = filedMs;
        }
    }

    // Both sides run back-to-back inside one round, so their ratio cancels the shared
    // background load; the median of per-round ratios is the robust gate figure.
    if (round >= 0) ratios.push(perRound.fixed / perRound.baseline);
}

console.log(`subscriber filing, ${subscribers} three-path subscribers`);
for (const side of ['baseline', 'fixed']) {
    const measurements = results[side];

    console.log(`  ${side}: file median=${median(measurements.map(m => m.filedMs)).toFixed(3)}ms `
        + `unfile median=${median(measurements.map(m => m.unfiledMs)).toFixed(3)}ms `
        + `(ns/path file=${(median(measurements.map(m => m.filedMs)) * 1e6 / (subscribers * 3)).toFixed(0)})`);
}

const ratio = median(ratios);
console.log(`  file ratio (median of per-round ratios)=${ratio.toFixed(3)} (gate <= 0.80)`);
