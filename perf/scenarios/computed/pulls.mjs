/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Unobserved pulls: stable pulls and pulls after an unrelated write re-run the body never, one
// changed dependency re-runs it once, and the pull cost stays flat as dependencies grow. The
// fan-in section is the old computedDependencies load: a diamond of 1/10/100 input computeds
// notifies its observed total exactly once per write. Args: [dependencies=12] [reads=10000]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const dependencies = Number(process.argv[2] ?? 12);
const reads = Number(process.argv[3] ?? 10000);
const stores = Array.from({length: dependencies}, () => new S({n: 1, other: 0}));
let evaluations = 0;
const source = computed(read => {
    evaluations++;
    return stores.reduce((sum, store) => sum + read(store).n, 0);
});
source.get();
for (let i = 0; i < 2000; i++) source.get();
let mark = evaluations;
global.gc?.();
const start = performance.now();
for (let i = 0; i < reads; i++) source.get();
const pullsMs = performance.now() - start;
const stableEvals = evaluations - mark;
stores[0].run(d => { d.other = 1; });
source.get();
const unrelatedEvals = evaluations - mark - stableEvals;
stores[0].run(d => { d.n = 2; });
const changed = source.get();
const changedEvals = evaluations - mark - stableEvals - unrelatedEvals;

// Observed fan-in: every write notifies the total exactly once, whatever the branch count.
const fanIn = branches => {
    const store = new S({n: 0});
    const inputs = Array.from({length: branches}, (_, i) => computed(read => read(store).n + i));
    const total = computed(read => inputs.reduce((sum, input) => sum + read(input), 0));
    let notifications = 0;
    total.subscribe(() => notifications++);
    for (let n = 1; n <= 100; n++) store.run(d => { d.n = n; });
    return {notifications, value: total.get()};
};
const fanIn1 = fanIn(1);
const fanIn10 = fanIn(10);
const fanIn100 = fanIn(100);
emit({pullsMs, stableEvals, unrelatedEvals, changedEvals, value: changed,
    fanIn1Notifications: fanIn1.notifications, fanIn1Value: fanIn1.value,
    fanIn10Notifications: fanIn10.notifications, fanIn10Value: fanIn10.value,
    fanIn100Notifications: fanIn100.notifications, fanIn100Value: fanIn100.value});
