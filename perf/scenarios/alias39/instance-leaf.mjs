/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, median} from '../../harness/lib.mjs';

if (!process.env.DIST_ROOT) throw new Error('DIST_ROOT is required');
const {Carburetor} = await load();
const size = Number(process.argv[2] ?? 10000);
if (!Number.isInteger(size) || size < 1) throw new Error('Expected positive size');

class Store extends Carburetor {
    run(fn) { this.update(fn); }
}
class Day {
    constructor(ms, extra = {}) { this.$d = new Date(ms); this.$x = extra; }
    valueOf() { return this.$d.getTime(); }
}

const countDescriptors = run => {
    const original = Reflect.getOwnPropertyDescriptor;
    let descriptors = 0;
    Reflect.getOwnPropertyDescriptor = (target, key) => {
        descriptors++;
        return original(target, key);
    };
    try {
        return {value: run(), descriptors};
    } finally {
        Reflect.getOwnPropertyDescriptor = original;
    }
};
const originalDescriptor = Reflect.getOwnPropertyDescriptor;
const controlObject = {value: 42};
const expectedControl = originalDescriptor(controlObject, 'value');
const control = countDescriptors(() => Reflect.getOwnPropertyDescriptor(controlObject, 'value'));
const controlCorrect = control.value.value === expectedControl.value &&
    control.value.writable === expectedControl.writable &&
    control.value.enumerable === expectedControl.enumerable &&
    control.value.configurable === expectedControl.configurable &&
    Reflect.getOwnPropertyDescriptor === originalDescriptor;

const store = new Store({
    current: {at: new Day(42)},
    items: Array.from({length: size}, (_, id) => ({id, n: 0})),
    meta: null,
});
const view = store.read(() => undefined);
const firstValue = +view.current.at;
const warmSamples = [];
const topologySamples = [];
let checksum = firstValue;
for (let rep = 0; rep < 21; rep++) {
    let start = performance.now();
    const warmValue = +view.current.at;
    warmSamples.push(performance.now() - start);
    checksum += warmValue;
    store.run(draft => { draft.meta = {rep}; });
    start = performance.now();
    const topologyValue = +view.current.at;
    topologySamples.push(performance.now() - start);
    checksum += topologyValue;
}
store.run(draft => { draft.meta = {rep: 21}; });
const measured = countDescriptors(() => +view.current.at);
checksum += measured.value;
const descriptorsRestored = Reflect.getOwnPropertyDescriptor === originalDescriptor;

const member = {n: 1};
const aliasStore = new Store({current: {at: new Day(42, member)}, ordinary: {member}, meta: null});
const paths = new Set();
const aliasView = aliasStore.read(path => paths.add(path));
const checkPaths = alias => {
    paths.clear();
    const exposed = aliasView.current.at.$x;
    return exposed === aliasStore.getData().ordinary.member && paths.has('ordinary.member') &&
        paths.has('ordinary.alias') === alias && paths.has('current.at') && !paths.has('*');
};
const aliasBefore = checkPaths(false);
const changes = [];
const stop = aliasStore.watch(data => data.current.at.$x.n, value => { changes.push(value); });
let siblingQuiet;
let aliasAdded;
let aliasDeleted;
try {
    aliasStore.run(draft => { draft.meta = {rep: 0}; });
    siblingQuiet = changes.length === 0;
    aliasStore.run(draft => { draft.ordinary.member.n = 2; });
    aliasStore.run(draft => { draft.ordinary.alias = member; });
    aliasAdded = checkPaths(true);
    aliasStore.run(draft => { draft.ordinary.member.n = 3; });
    aliasStore.run(draft => { draft.ordinary.alias.n = 4; });
    aliasStore.run(draft => { delete draft.ordinary.alias; });
    aliasDeleted = checkPaths(false);
    aliasStore.run(draft => { draft.ordinary.member.n = 5; });
} finally {
    stop();
}
const finalValue = aliasView.current.at.$x.n;
const aliasCorrect = aliasBefore && aliasAdded && aliasDeleted && siblingQuiet &&
    changes.join(',') === '2,3,4,5' && finalValue === 5 && !('alias' in aliasStore.getData().ordinary);

emit({
    descriptorsPerRead: measured.descriptors,
    expectedDescriptors: 1 + 2,
    baselineDescriptorsApprox: 3 * size + 7,
    controlDescriptors: control.descriptors,
    controlCorrect,
    descriptorsRestored,
    warmMs: median(warmSamples),
    topologyMs: median(topologySamples),
    firstValue,
    topologyValue: measured.value,
    checksum,
    aliasBefore,
    aliasAdded,
    aliasDeleted,
    aliasWakes: changes.length,
    aliasValues: changes.join(','),
    finalValue,
    aliasCorrect,
    done: firstValue === 42 && measured.value === 42 && checksum === 44 * 42 &&
        controlCorrect && descriptorsRestored && aliasCorrect,
});
