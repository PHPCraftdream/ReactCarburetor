/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// An observed computed behind `useComputedValue`: stable pulls and unrelated writes re-run the
// body never; each real change announces, re-runs the body, commits once and publishes exactly
// one new snapshot record (the old computedFreshness contract). Args: [mode=native] [dependencies=12] [writes=20] [stableReads=400]
import {emit, load, setupReact} from '../../harness/lib.mjs';

const mode = process.argv[2] ?? 'native';
const dependencies = Number(process.argv[3] ?? 12);
const writes = Number(process.argv[4] ?? 20);
const stableReads = Number(process.argv[5] ?? 400);
const {Carburetor, computed} = await load();
const {useComputedValue} = await load('Interop');
const {React, flushSync, root, container} = await setupReact();
class S extends Carburetor { run(fn) { this.update(fn); } }

const stores = Array.from({length: dependencies}, () => new S({value: 0, other: 0}));
let bridge;
if (mode === 'external') {
    // Duck-typed IComputed over stores[0].value: the external computed dependency contract.
    let version = 0;
    let value = 0;
    const listeners = new Set();
    stores[0].subscribe(() => {
        const next = stores[0].getData().value;
        if (next === value) return;
        value = next;
        version++;
        listeners.forEach(listener => listener());
    });
    bridge = {
        getUID: () => 'freshness-bridge',
        getVersion: () => version,
        get: () => value,
        subscribe: callback => (listeners.add(callback), listeners.size),
        unsubscribe: () => listeners.clear(),
    };
}
let evaluations = 0;
const source = computed(read => {
    evaluations++;
    let sum = bridge ? read(bridge) : read(stores[0]).value;
    for (let i = 1; i < dependencies; i++) sum += read(stores[i]).value;
    return sum;
});

// The snapshot-record seam: every snapshot the hook serves goes through source.get(), so a
// fresh record — a value Object.is cannot reuse — is counted exactly here.
let snapshotRecords = 0;
let lastSnapshotValue;
const originalGet = source.get;
source.get = function () {
    const value = originalGet.call(this);
    if (lastSnapshotValue !== undefined && !Object.is(value, lastSnapshotValue)) {
        snapshotRecords++;
    }
    lastSnapshotValue = value;
    return value;
};

let announcements = 0;
source.subscribe(() => announcements++);
let renders = 0;
const View = () => {
    renders++;
    return React.createElement('span', null, useComputedValue(source));
};
flushSync(() => root.render(React.createElement(View)));
const mountedRenders = renders;

let mark = evaluations;
global.gc?.();
const start = performance.now();
for (let i = 0; i < stableReads; i++) source.get();
const stableMs = performance.now() - start;
const bodyEvalsStable = evaluations - mark;
const stableSnapshotRecords = snapshotRecords;
mark = evaluations;
const writeStart = performance.now();
for (let i = 1; i <= writes; i++) {
    flushSync(() => stores[dependencies - 1].run(d => { d.value = i; }));
}
const writeMs = performance.now() - writeStart;
const bodyEvalsChanged = evaluations - mark;
const changedSnapshotRecords = snapshotRecords - stableSnapshotRecords;
flushSync(() => stores[0].run(d => { d.other = 1; }));
emit({stableMs, writeMs, bodyEvalsStable, bodyEvalsChanged, stableSnapshotRecords, changedSnapshotRecords,
    announcements, renders: renders - mountedRenders, text: container.textContent});
root.unmount();
