import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Module, {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {Session} from 'node:inspector';

// Transpile in memory to measure current sources without rewriting distribution files.
const require = createRequire(import.meta.url);
const {transformSync} = require('@rspack/core').experiments.swc;
const computedPath = resolve('lib/src/Carburetor/Derived/Computed.ts');
let selectedRef = process.env.BENCH_REF;
let selectedVariant = process.env.BENCH_VARIANT;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    return originalResolve.call(this, request.startsWith('@/')
        ? resolve('lib/src', request.slice(2)) : request, ...args);
};
Module._extensions['.ts'] = (module, filename) => {
    let source = selectedRef && selectedRef !== 'current' && filename === computedPath
        ? execFileSync('git', ['show', `${selectedRef}:lib/src/Carburetor/Derived/Computed.ts`],
            {encoding: 'utf8'}) : readFileSync(filename, 'utf8');
    // Diagnostic control only: production must support external ids such as __proto__.
    if (selectedVariant === 'ordinary-records' && filename === computedPath) {
        source = source.replaceAll('Object.create(null)', '({})');
    }
    if (selectedVariant === 'immutable-announcement' && filename === computedPath) {
        source = source.replaceAll('{...this.versions}', 'this.versions');
    }
    module._compile(transformSync(source, {jsc: {
        parser: {syntax: 'typescript'}, target: 'es2020',
    }, module: {type: 'commonjs'}},
    ).code, filename);
};
process.env.NODE_ENV = 'production';
const implementations = (process.env.BENCH_COMPARE?.split(',')
    || [process.env.BENCH_REF || 'current']).map(label => {
    [selectedRef, selectedVariant = process.env.BENCH_VARIANT] = label.split(':');
    delete require.cache[computedPath];
    return {label, Computed: require(computedPath).Computed};
});
const {Carburetor} = require(resolve('lib/src/Carburetor/Store/Carburetor.ts'));
const rounds = Number(process.env.BENCH_ROUNDS || 7);
const writes = Number(process.env.BENCH_WRITES || 500);
const warmup = Number(process.env.BENCH_WARMUP || 100);
const profiler = process.env.BENCH_PROFILE ? new Session() : undefined;
if (profiler) {
    profiler.connect();
    profiler.post('Profiler.enable');
    profiler.post('Profiler.start');
}

for (const branches of process.env.BENCH_BRANCHES?.split(',').map(Number) || [1, 10, 100]) {
    const results = new Map(implementations.map(({label}) => [label, []]));
    for (let round = 0; round < rounds; round++) {
        // Rotate order so concurrent desktop activity does not always penalize one source.
        const order = round % 2 ? [...implementations].reverse() : implementations;
        for (const {label, Computed} of order) {
            const store = new Carburetor({n: 0});
            const inputs = Array.from({length: branches}, (_, i) =>
                new Computed(read => read(store).n + i));
            const total = new Computed(read => inputs.reduce((sum, input) => sum + read(input), 0));
            let notifications = 0;
            const id = total.subscribe(() => notifications++);
            for (let n = 1; n <= warmup; n++) {
                store.update(draft => { draft.n = n; });
            }
            const started = performance.now();
            for (let n = warmup + 1; n <= warmup + writes; n++) {
                store.update(draft => { draft.n = n; });
            }
            results.get(label).push((performance.now() - started) / writes);
            assert.equal(notifications, warmup + writes);
            assert.equal(total.get(), branches * (warmup + writes) + branches * (branches - 1) / 2);
            total.unsubscribe(id);
        }
    }
    for (const [source, observations] of results) {
        const samples = [...observations].sort((a, b) => a - b);
        console.log(JSON.stringify({source, branches, rounds, writes, warmup,
            samples: observations,
            medianMsPerWrite: samples[Math.floor(rounds / 2)],
            minMsPerWrite: samples[0], maxMsPerWrite: samples[rounds - 1]}));
    }
}
if (profiler) {
    profiler.post('Profiler.stop', (error, {profile}) => {
        assert.ifError(error);
        const frames = new Map(profile.nodes.map(node => [node.id, node.callFrame]));
        const times = new Map();
        profile.samples.forEach((id, index) => {
            const frame = frames.get(id);
            const name = `${frame.functionName || '(anonymous)'}:${frame.url.split('/').pop()}`;
            times.set(name, (times.get(name) || 0) + profile.timeDeltas[index]);
        });
        console.log(JSON.stringify({profileSelfMs: [...times].sort((a, b) => b[1] - a[1])
            .slice(0, 20).map(([name, micros]) => ({name, ms: micros / 1000}))}));
    });
    profiler.disconnect();
}
