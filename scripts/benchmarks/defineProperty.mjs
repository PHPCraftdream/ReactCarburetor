import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {rspack} from '@rspack/core';

const root = resolve(process.env.BENCH_SOURCE || '.');
const revision = process.argv[2] || process.env.BENCH_REVISION;
const plugins = [];
if (revision) {
    const sourcePath = 'lib/src/Carburetor/Store/Tracking/createWriteProxy.ts';
    const source = execFileSync('git', ['show', revision + ':' + sourcePath], {cwd: root, encoding: 'utf8'});
    plugins.push(new rspack.experiments.VirtualModulesPlugin({[resolve(root, sourcePath)]: source}));
}
const output = mkdtempSync(resolve(tmpdir(), 'carburetor-definition-'));
const compiler = rspack({
    mode: 'production', target: 'node', devtool: false, cache: false,
    plugins,
    entry: {
        store: resolve(root, 'lib/src/Carburetor/Store/Carburetor.ts'),
        history: resolve(root, 'lib/src/Carburetor/Tooling/CarburetorHistory.ts'),
    },
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
    ({Carburetor} = require(resolve(output, 'store.cjs')));
    ({CarburetorHistory} = require(resolve(output, 'history.cjs')));
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
