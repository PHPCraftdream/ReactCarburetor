// Exotic mutations are intentional benchmark inputs.
/* oxlint-disable carburetor/no-untrackable-draft-mutation */
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {Session} from 'node:inspector';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {rspack} from '@rspack/core';
import {JSDOM} from 'jsdom';
import React, {act, Profiler} from 'react';
import {createRoot} from 'react-dom/client';

const root = resolve(process.cwd());
const revision = process.argv[2];
const label = revision || 'current';
const output = mkdtempSync(resolve(tmpdir(), 'carburetor-hook-'));
const hookPath = 'lib/src/Interop/useComputedValue.ts';
const {readFileSync} = await import('node:fs');
const hook = revision
    ? execFileSync('git', ['show', `${revision}:${hookPath}`], {cwd: root, encoding: 'utf8'})
    : readFileSync(resolve(root, hookPath), 'utf8');
const entry = resolve(root, 'scripts/benchmarks/.computedHook-entry.ts');
const shim = resolve(root, 'scripts/benchmarks/.computedHook-react.ts');
const instrumentedReact = `
import * as React from 'react';
export const useCallback = React.useCallback;
export const useSyncExternalStore = (subscribe, getSnapshot, getServerSnapshot) => {
    const measure = React.useCallback(() => {
        const result = getSnapshot();
        const metrics = globalThis.__computedHookMetrics;
        if (metrics) {
            metrics.snapshotCalls++;
            if (result !== null && typeof result === 'object' && !metrics.seen.has(result)) {
                metrics.seen.add(result);
                metrics.distinctObjectSnapshots++;
            }
        }
        return result;
    }, [getSnapshot]);
    return React.useSyncExternalStore(subscribe, measure, getServerSnapshot);
};`;
const compiler = rspack({
    context: root, mode: 'none', target: 'node', devtool: false,
    entry, output: {path: output, filename: 'hook.cjs', library: {type: 'commonjs2'}},
    externals: {react: 'commonjs react'},
    plugins: [new rspack.experiments.VirtualModulesPlugin({
        [entry]: "export {Carburetor} from '@/Carburetor/Store/Carburetor';\n"
            + "export {computed} from '@/Carburetor/Derived/computedFactory';\n"
            + "export {useComputedValue} from '@/Interop/useComputedValue';",
        [resolve(root, hookPath)]: hook.replace('from "react"', 'from "@benchmark/react"'),
        [shim]: instrumentedReact,
    })],
    resolve: {extensions: ['.ts', '.js'], alias: {'@': resolve(root, 'lib/src'), '@benchmark/react': shim}},
    module: {rules: [{test: /\.ts$/, loader: 'builtin:swc-loader',
        options: {jsc: {parser: {syntax: 'typescript'}, target: 'es2020'}}}]},
});
let library;

try {
    await new Promise((done, fail) => compiler.run((error, stats) => {
        if (error || stats.hasErrors()) fail(error || new Error(stats.toString({all: false, errors: true})));
        else done();
    }));
    const require = createRequire(import.meta.url);
    const Module = require('node:module');
    const loaded = new Module(resolve(output, 'hook.cjs'));
    loaded.filename = resolve(output, 'hook.cjs');
    loaded.paths = Module._nodeModulePaths(root);
    loaded._compile(readFileSync(loaded.filename, 'utf8'), loaded.filename);
    library = loaded.exports;
} finally {
    await new Promise((done, fail) => compiler.close(error => error ? fail(error) : done()));
    rmSync(output, {recursive: true, force: true});
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {Carburetor, computed, useComputedValue} = library;
class Store extends Carburetor {
    /** Publishes one dependency change. */
    increment = () => this.update(draft => { draft.count++; draft.index.set('a', draft.count); });
}
const make = (count, kind) => {
    const store = new Store({count: 0, index: new Map([['a', 0]])});
    const envelope = {index: store.getData().index};
    const source = computed(read => {
        const state = read(store);
        if (kind === 'primitive') return state.count;
        if (kind === 'object') return {count: state.count};
        if (kind === 'map') return state.index;
        void state.index;
        return envelope;
    });
    const metrics = {commits: 0, consumerRenders: 0, snapshotCalls: 0, distinctObjectSnapshots: 0,
        seen: new WeakSet()};
    const Child = () => {
        // oxlint-disable-next-line react/immutability -- Count benchmark renders.
        metrics.consumerRenders++;
        const value = useComputedValue(source);
        const display = kind === 'primitive' ? value : kind === 'object' ? value.count
            : kind === 'map' ? value.get('a') : value.index.get('a');
        return React.createElement('span', null, display);
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const reactRoot = createRoot(host);
    globalThis.__computedHookMetrics = metrics;
    act(() => reactRoot.render(React.createElement(Profiler,
        {id: 'consumers', onRender: () => { metrics.commits++; }},
        Array.from({length: count}, (_, key) => React.createElement(Child, {key})))));
    const mounted = {commits: metrics.commits, consumerRenders: metrics.consumerRenders,
        snapshotCalls: metrics.snapshotCalls, distinctObjectSnapshots: metrics.distinctObjectSnapshots};
    const cleanup = () => { act(() => reactRoot.unmount()); host.remove(); };
    return {store, source, metrics, mounted, host, cleanup};
};
const writes = 10;
const rounds = 3;
const runWrites = state => {
    globalThis.__computedHookMetrics = state.metrics;
    const start = performance.now();
    for (let index = 0; index < writes; index++) act(state.store.increment);
    return performance.now() - start;
};
const counters = state => Object.fromEntries(Object.keys(state.mounted)
    .map(key => [key, state.metrics[key] - state.mounted[key]]));
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const inspector = new Session();
inspector.connect();
const post = (method, params = {}) => new Promise((done, fail) => {
    inspector.post(method, params, (error, result) => error ? fail(error) : done(result));
});
const bytes = node => node.selfSize + node.children.reduce((sum, child) => sum + bytes(child), 0);
const recordBytes = node => (node.callFrame.functionName === 'readSnapshot' ? node.selfSize : 0)
    + node.children.reduce((sum, child) => sum + recordBytes(child), 0);

try {
    for (const count of [1, 100, 1000]) {
        for (const kind of ['primitive', 'object', 'map', 'envelope']) {
            const warm = make(count, kind);
            runWrites(warm);
            warm.cleanup();
            const samples = [];
            for (let round = 0; round < rounds; round++) {
                const state = make(count, kind);
                globalThis.gc?.();
                const heapBefore = process.memoryUsage().heapUsed;
                const elapsedMs = runWrites(state);
                const uncollectedHeapDeltaBytes = process.memoryUsage().heapUsed - heapBefore;
                const visible = state.host.firstChild.textContent;
                const expected = !revision || (kind !== 'map' && kind !== 'envelope') ? String(writes) : '0';
                if (visible !== expected) throw new Error(`${label}/${kind}: unexpected DOM ${visible}`);
                globalThis.gc?.();
                samples.push({...counters(state), elapsedMs, uncollectedHeapDeltaBytes,
                    retainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore, visible,
                    versionDelta: state.source.getVersion()});
                state.cleanup();
            }
            const state = make(count, kind);
            globalThis.gc?.();
            await post('HeapProfiler.startSampling', {samplingInterval: 512,
                includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true});
            runWrites(state);
            const {profile} = await post('HeapProfiler.stopSampling');
            state.cleanup();
            console.log(JSON.stringify({label, count, kind, writes, rounds,
                commits: samples.map(sample => sample.commits),
                consumerRenders: samples.map(sample => sample.consumerRenders),
                snapshotCalls: samples.map(sample => sample.snapshotCalls),
                distinctObjectSnapshots: samples.map(sample => sample.distinctObjectSnapshots),
                visible: samples.map(sample => sample.visible),
                versions: samples.map(sample => sample.versionDelta),
                medianElapsedMs: median(samples.map(sample => sample.elapsedMs)),
                medianUncollectedHeapDeltaBytes: median(samples.map(sample => sample.uncollectedHeapDeltaBytes)),
                medianRetainedHeapDeltaBytes: median(samples.map(sample => sample.retainedHeapDeltaBytes)),
                estimatedSampledAllocatedBytes: bytes(profile.head),
                estimatedReadSnapshotSelfBytes: recordBytes(profile.head)}));
        }
    }
} finally {
    inspector.disconnect();
    globalThis.__computedHookMetrics = undefined;
    dom.window.close();
}
console.log('Development React/JSDOM; update-only metrics exclude mount, cleanup, bundling and allocation profiling. '
    + 'Only the hook is replaced for a revision comparison. Snapshot-call instrumentation adds a callback hook '
    + 'and a WeakSet lookup; distinct object snapshots are exact identities, not allocated-byte counts. '
    + 'Current records are shared per source across consumers. Inspector allocation estimates include React, '
    + 'DOM, engine and instrumentation; readSnapshot self bytes are sampled attribution, not exact sizes. '
    + 'Retained/uncollected heap deltas are not allocations. Old stable-result cases skip required renders, '
    + 'so their times/bytes do not measure equivalent successful work. JIT/GC/sampling noise affect comparisons.');
