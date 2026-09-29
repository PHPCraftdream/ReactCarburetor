import {performance} from 'node:perf_hooks';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const dist = resolve(process.env.BENCH_DIST || 'dist');
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const [{Carburetor}, {connectDevTools}] = await Promise.all([
    load('esm-prod/Carburetor/Store/Carburetor.mjs'),
    load('esm-prod/Carburetor/Tooling/connectDevTools.mjs'),
]);

const ROUNDS = 9;
const WRITES = 500;
const samples = [];

for (let round = 0; round < ROUNDS; round++) {
    const store = new Carburetor({value: 0});
    let sent = 0;
    const extension = {connect: () => ({
        init: () => undefined,
        send: () => { sent++; },
        subscribe: () => () => undefined,
    })};
    const dispose = connectDevTools({counter: store}, {extension});
    const started = performance.now();

    for (let write = 1; write <= WRITES; write++) {
        store.setData({value: write});
    }

    samples.push((performance.now() - started) / WRITES);
    dispose();

    if (sent !== WRITES) {
        throw new Error(`Expected ${WRITES} publications, got ${sent}`);
    }
}

samples.sort((a, b) => a - b);
console.log(JSON.stringify({rounds: ROUNDS, writesPerRound: WRITES,
    medianMsPerWrite: samples[Math.floor(ROUNDS / 2)],
    minMsPerWrite: samples[0], maxMsPerWrite: samples[ROUNDS - 1]}));
