import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {rspack} from '@rspack/core';

const root = resolve(process.env.BENCH_SOURCE || '.');
const revision = process.argv[2] || process.env.BENCH_REVISION;
const entry = resolve(root, 'scripts/benchmarks/.defineProperty-entry.ts');
const virtual = {[entry]: "export {Carburetor} from '@/Carburetor/Store/Carburetor';\n"
    + "export {CarburetorHistory} from '@/Carburetor/Tooling/CarburetorHistory';"};
if (revision) {
    const sourcePath = 'lib/src/Carburetor/Store/Tracking/createWriteProxy.ts';
    const source = execFileSync('git', ['show', revision + ':' + sourcePath], {cwd: root, encoding: 'utf8'});
    virtual[resolve(root, sourcePath)] = source;
}
const output = mkdtempSync(resolve(tmpdir(), 'carburetor-definition-'));
const compiler = rspack({
    mode: 'production', target: 'node', devtool: false, cache: false,
    plugins: [new rspack.experiments.VirtualModulesPlugin(virtual)],
    entry,
    output: {path: output, filename: '[name].cjs', library: {type: 'commonjs2'}},
    resolve: {extensions: ['.ts', '.js'], alias: {'@': resolve(root, 'lib/src')}},
    module: {rules: [{test: /\.ts$/, use: {loader: 'builtin:swc-loader', options: {
        jsc: {parser: {syntax: 'typescript'}, target: 'es2020'},
    }}}]},
    optimization: {minimize: false},
});
let Carburetor;
let CarburetorHistory;
try {
    await new Promise((accept, reject) => compiler.run((error, stats) => {
        if (error || stats.hasErrors()) reject(error || new Error(stats.toString({all: false, errors: true})));
        else accept();
    }));
    const require = createRequire(import.meta.url);
    ({Carburetor, CarburetorHistory} = require(resolve(output, 'main.cjs')));
} finally {
    await new Promise((accept, reject) => compiler.close(error => error ? reject(error) : accept()));
    rmSync(output, {recursive: true, force: true});
}

class Store extends Carburetor {
    /** Defines the counter.
     *
     * @param omit - whether to preserve its value
     */
    define(omit) {
        this.update(draft => {
            Object.defineProperty(draft, 'count', omit
                ? {enumerable: true, writable: true, configurable: true}
                : {value: draft.count + 1, enumerable: true, writable: true, configurable: true});
        });
    }
}

const rounds = 7;
const writes = 1000;
for (const omit of [true, false]) {
    const samples = [];
    let callbacks = 0;
    let versions = 0;
    let historyEntries = 0;
    for (let round = 0; round < rounds; round++) {
        const store = new Store({count: 1});
        const history = new CarburetorHistory(store, {limit: writes});
        let delivered = 0;
        const subscription = store.subscribe(() => delivered++);
        const started = performance.now();
        for (let index = 0; index < writes; index++) store.define(omit);
        samples.push(performance.now() - started);
        versions += store.getVersion();
        callbacks += delivered;
        while (history.undo()) historyEntries++;
        store.unsubscribe(subscription);
        history.disconnect();
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({operation: omit ? 'omitted-value' : 'changed-value', rounds, writes,
        versions, callbacks, historyEntries, medianMs: samples[Math.floor(rounds / 2)],
        minMs: samples[0], maxMs: samples[rounds - 1]}));
}

class ArrayStore extends Carburetor {
    /** Defines an index beyond the original length.
     *
     * @param index - index to append
     */
    define(index) {
        this.update(draft => Object.defineProperty(draft.items, String(index), {
            value: index, enumerable: true, writable: true, configurable: true,
        }));
    }
}

const growthWrites = 250;
const samples = [];
let lengthCallbacks = 0;
let keyCallbacks = 0;
let untouchedCallbacks = 0;
let versions = 0;
const undoLengths = [];
const redoLengths = [];
for (let round = 0; round < rounds; round++) {
    const store = new ArrayStore({items: [0]});
    const history = new CarburetorHistory(store, {limit: growthWrites});
    const subscriptions = [
        store.subscribe(() => lengthCallbacks++, {reads: new Set(['items.length'])}),
        store.subscribe(() => keyCallbacks++, {reads: new Set(['items.~k'])}),
        store.subscribe(() => untouchedCallbacks++, {reads: new Set(['items.0'])}),
    ];
    const started = performance.now();
    for (let index = 1; index <= growthWrites; index++) store.define(index);
    samples.push(performance.now() - started);
    versions += store.getVersion();
    subscriptions.forEach(id => store.unsubscribe(id));
    while (history.undo()) { /* replay all recorded growth */ }
    undoLengths.push(store.getData().items.length);
    while (history.redo()) { /* restore all recorded growth */ }
    redoLengths.push(store.getData().items.length);
    if (!revision && undoLengths[round] !== 1) throw new Error('Growth undo did not restore the original length');
    if (redoLengths[round] !== growthWrites + 1) throw new Error('Growth redo did not restore the extended length');
    history.disconnect();
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({operation: 'array-growth', rounds, writes: growthWrites, versions,
    lengthCallbacks, keyCallbacks, untouchedCallbacks, undoLengths, redoLengths,
    medianMs: samples[Math.floor(rounds / 2)], minMs: samples[0], maxMs: samples[rounds - 1]}));
