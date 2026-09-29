import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import Module, {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';

// Transpile in memory to measure current sources without rewriting distribution files.
const require = createRequire(import.meta.url);
const {transformSync} = require('@rspack/core').experiments.swc;
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    return originalResolve.call(this, request.startsWith('@/')
        ? resolve('lib/src', request.slice(2)) : request, ...args);
};
Module._extensions['.ts'] = (module, filename) => module._compile(transformSync(
    process.env.BENCH_REF && filename === resolve('lib/src/Carburetor/Derived/Computed.ts')
        ? execFileSync('git', ['show', `${process.env.BENCH_REF}:lib/src/Carburetor/Derived/Computed.ts`],
            {encoding: 'utf8'}) : readFileSync(filename, 'utf8'), {jsc: {
        parser: {syntax: 'typescript'}, target: 'es2020',
    }, module: {type: 'commonjs'}},
).code, filename);
process.env.NODE_ENV = 'production';
const {Computed} = require(resolve('lib/src/Carburetor/Derived/Computed.ts'));
const {Carburetor} = require(resolve('lib/src/Carburetor/Store/Carburetor.ts'));
const rounds = 7;
const writes = 500;
const warmup = 100;

for (const branches of [1, 10, 100]) {
    const samples = [];
    for (let round = 0; round < rounds; round++) {
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
        samples.push((performance.now() - started) / writes);
        assert.equal(notifications, warmup + writes);
        assert.equal(total.get(), branches * (warmup + writes) + branches * (branches - 1) / 2);
        total.unsubscribe(id);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({source: process.env.BENCH_REF || 'current', branches, rounds, writes, warmup,
        medianMsPerWrite: samples[Math.floor(rounds / 2)],
        minMsPerWrite: samples[0], maxMsPerWrite: samples[rounds - 1]}));
}
