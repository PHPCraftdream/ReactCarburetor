import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import Module, {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

// Paired prebuilt distributions: BASELINE_DIST=<old>/dist AFTER_DIST=<new>/dist node ...
const baseline = process.env.BASELINE_DIST;
const after = process.env.AFTER_DIST;
if (!baseline || !after) throw new Error('Set BASELINE_DIST and AFTER_DIST to built dist roots');
const cwd = process.cwd();
const repo = existsSync(resolve(cwd, 'lib/node_modules/react/package.json')) ? cwd : resolve(cwd, '../..');
const dependencyRequire = createRequire(resolve(repo, 'lib/package.json'));
const reactEntry = dependencyRequire.resolve('react');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
    return originalResolve.call(this, request === 'react' ? reactEntry : request, ...args);
};
const React = dependencyRequire('react');
const {JSDOM} = dependencyRequire('jsdom');
const {createRoot} = dependencyRequire('react-dom/client');
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const realUseSyncExternalStore = React.useSyncExternalStore;
let currentSnapshotMetrics;
React.useSyncExternalStore = function (subscribe, getSnapshot, getServerSnapshot) {
    const metrics = currentSnapshotMetrics;
    const measured = () => {
        const snapshot = getSnapshot();
        metrics.snapshotChecks++;
        if (snapshot && typeof snapshot === 'object' && !metrics.snapshots.has(snapshot)) {
            metrics.snapshots.add(snapshot);
            metrics.snapshotRecords++;
        }
        metrics.check = measured;
        return snapshot;
    };
    return realUseSyncExternalStore(subscribe, measured, getServerSnapshot);
};
const variants = [
    {name: 'baseline/native', root: resolve(baseline), adapter: false},
    {name: 'after/native', root: resolve(after), adapter: false},
    {name: 'baseline/adapter', root: resolve(baseline), adapter: true},
    {name: 'after/adapter', root: resolve(after), adapter: true},
];
const rounds = Math.min(Number(process.env.BENCH_ROUNDS || 5), 12);
const stableReads = Math.min(Number(process.env.BENCH_READS || 400), 2000);
const writes = Math.min(Number(process.env.BENCH_WRITES || 20), 100);
if (![rounds, stableReads, writes].every(n => Number.isSafeInteger(n) && n > 0)) {
    throw new Error('BENCH_ROUNDS, BENCH_READS and BENCH_WRITES must be positive integers');
}
for (const variant of variants) {
    const load = path => dependencyRequire(resolve(variant.root, 'cjs', path));
    variant.Carburetor = load('Carburetor/Store/Carburetor.js').Carburetor;
    variant.computed = load('Carburetor/Derived/computedFactory.js').computed;
    variant.useComputedValue = load('Interop/useComputedValue.js').useComputedValue;
}
const records = [];
for (let round = 0; round < rounds; round++) {
    // Alternate order to reduce warmup/GC bias; report raw per-round distributions.
    for (const variant of round % 2 ? [...variants].reverse() : variants) {
        for (const dependencyCount of [1, 12]) {
            const metrics = {bodyEvaluations: 0, versionChecks: 0, announcements: 0,
                snapshotChecks: 0, snapshotRecords: 0, snapshots: new WeakSet(), check: undefined,
                commits: 0};
            class Store extends variant.Carburetor {
                /** Publishes the tracked value.
                 *
                 * @param value - next tracked value
                 */
                setValue(value) { this.update(draft => { draft.value = value; }); }
                /** Publishes an unrelated control field.
                 *
                 * @param value - next unrelated value
                 */
                setOther(value) { this.update(draft => { draft.other = value; }); }
            }
            if (variant.adapter) {
                const getVersion = Store.prototype.getVersion;
                Store.prototype.getVersion = function () {
                    metrics.versionChecks++;
                    return getVersion.call(this);
                };
            }
            const stores = Array.from({length: dependencyCount}, () => new Store({value: 0, other: 0}));
            const derived = variant.computed(read => {
                metrics.bodyEvaluations++;
                return stores.reduce((sum, store) => sum + read(store).value, 0);
            });
            const id = derived.subscribe(() => { metrics.announcements++; });
            const host = document.createElement('div');
            document.body.appendChild(host);
            const root = createRoot(host);
            const View = () => React.createElement('span', null, variant.useComputedValue(derived));
            currentSnapshotMetrics = metrics;
            React.act(() => root.render(React.createElement(React.Profiler,
                {id: 'computed', onRender: () => { metrics.commits++; }}, React.createElement(View))));
            const mounted = {...metrics};
            const startStable = performance.now();
            for (let index = 0; index < stableReads; index++) {
                assert.equal(derived.get(), 0);
                assert.strictEqual(metrics.check(), metrics.check());
            }
            const stableMs = performance.now() - startStable;
            const stable = {bodyEvaluations: metrics.bodyEvaluations - mounted.bodyEvaluations,
                versionChecks: variant.adapter ? metrics.versionChecks - mounted.versionChecks : null,
                snapshotChecks: metrics.snapshotChecks - mounted.snapshotChecks,
                snapshotRecords: metrics.snapshotRecords - mounted.snapshotRecords,
                commits: metrics.commits - mounted.commits};
            assert.equal(stable.bodyEvaluations, 0);
            assert.equal(stable.snapshotRecords, 0);
            const startWrites = performance.now();
            for (let index = 1; index <= writes; index++) {
                React.act(() => stores[0].setValue(index));
                assert.equal(derived.get(), index);
                // Measure a matching write and a write outside the recorded read set.
                React.act(() => stores[0].setOther(index));
                assert.equal(derived.get(), index);
            }
            const writesMs = performance.now() - startWrites;
            assert.equal(metrics.announcements, writes);
            assert.equal(host.textContent, String(writes));
            const changed = {bodyEvaluations: metrics.bodyEvaluations - mounted.bodyEvaluations,
                versionChecks: variant.adapter
                    ? metrics.versionChecks - mounted.versionChecks - stable.versionChecks : null,
                snapshotChecks: metrics.snapshotChecks - mounted.snapshotChecks - stable.snapshotChecks,
                snapshotRecords: metrics.snapshotRecords - mounted.snapshotRecords,
                announcements: metrics.announcements, commits: metrics.commits - mounted.commits};
            assert.equal(changed.snapshotRecords, writes);
            React.act(() => root.unmount());
            derived.unsubscribe(id);
            host.remove();
            records.push({variant: variant.name, round, dependencyCount, stableReads, writes,
                stableMs, writesMs, stable, changed});
        }
    }
}
React.useSyncExternalStore = realUseSyncExternalStore;
console.log(JSON.stringify(records, null, 2));
