import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST};
if (!roots.baseline || !roots.fixed) throw new Error('Set BASELINE_DIST and AFTER_DIST');
const sides = Object.fromEntries(Object.entries(roots).map(([label, root]) => [label, {
    Carburetor: require(resolve(root, 'cjs-prod/Carburetor/Store/Carburetor.js')).Carburetor,
    Computed: require(resolve(root, 'cjs-prod/Carburetor/Derived/Computed.js')).Computed,
}]));
const reads = 10000;
const rounds = 7;
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const dependencies of [1, 12, 128]) {
    const samples = {baseline: [], fixed: []};
    const controls = {};
    for (let round = -2; round < rounds; round++) {
        for (const label of round % 2 ? ['fixed', 'baseline'] : ['baseline', 'fixed']) {
            const {Carburetor, Computed} = sides[label];
            class Store extends Carburetor {
                /** Publishes one real input change.
                 *
                 * @param key - input field
                 * @param value - next field value
                 */
                change(key, value) { this.update(draft => { draft[key] = value; }); }
            }
            const stores = Array.from({length: dependencies}, () => new Store({n: 1, other: 0}));
            let evaluations = 0;
            const computed = new Computed(read => {
                evaluations++;
                return stores.reduce((sum, store) => sum + read(store).n, 0);
            });
            assert.equal(computed.get(), dependencies);
            const initialRuns = evaluations;
            const start = performance.now();
            let result;
            for (let index = 0; index < reads; index++) result = computed.get();
            const elapsedMs = performance.now() - start;
            assert.equal(result, dependencies);
            assert.equal(evaluations, initialRuns);
            stores[0].change('other', 1);
            assert.equal(computed.get(), dependencies);
            const unrelatedEvaluations = evaluations - initialRuns;
            stores[0].change('n', 2);
            assert.equal(computed.get(), dependencies + 1);
            assert.equal(evaluations, initialRuns + unrelatedEvaluations + 1);
            controls[label] = {stableEvaluations: 0, unrelatedEvaluations, changedEvaluations: 1};
            if (round >= 0) samples[label].push(elapsedMs);
        }
    }
    const ratios = samples.fixed.map((time, index) => time / samples.baseline[index]);
    console.log(JSON.stringify({dependencies, reads, rounds, samplesMs: samples, controls,
        medianBaselineMs: median(samples.baseline), medianFixedMs: median(samples.fixed),
        medianPairedRatio: median(ratios)}));
}
console.log('Production unobserved pulls; setup and writes excluded from timings. Times are not allocated bytes.');
