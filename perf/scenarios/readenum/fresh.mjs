/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-06: enumerating keys through a read view must not wrap (and then retain) the values it
// discards. Retained heap per fresh enumerated view is compared against a small control in the
// same process. Args: [keys=10000] [rounds=8]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();

const keys = Number(process.argv[2] ?? 10000);
const rounds = Number(process.argv[3] ?? 8);
const controlKeys = Math.min(2500, keys);
const makeById = size => Object.fromEntries(
    Array.from({length: size}, (_, n) => ['k' + n, {title: 't' + n, done: n % 2 === 0}])
);

const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };

// Retained heap per fresh enumerated view: one new view per round, median of the marginal
// growth so shared per-view setup amortizes out.
const retained = size => {
    const store = new Carburetor({byId: makeById(size), other: 0});
    const views = [];
    global.gc();
    let previous = heap();
    const freshMs = [];
    const growth = [];
    let keysSeen = 0;
    for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        const view = store.read(() => undefined);
        const list = Object.keys(view.byId);
        freshMs.push(performance.now() - start);
        keysSeen = list.length;
        if (list.length !== size) throw new Error(`enumerated ${list.length} of ${size} keys`);
        views.push(view);
        const now = heap();
        growth.push((now - previous) / 1024);
        previous = now;
    }
    const spotOk = views[0].byId.k5.title === 't5';
    return {freshMs: median(freshMs), retainedKb: median(growth), spotOk, keysSeen};
};

const main = retained(keys);
const control = retained(controlKeys);

const warmStore = new Carburetor({byId: makeById(keys), other: 0});
const warmView = warmStore.read(() => undefined);
Object.keys(warmView.byId);
const warmStart = performance.now();
for (let round = 0; round < 10; round++) Object.keys(warmView.byId);
const warmMs = (performance.now() - warmStart) / 10;

emit({
    freshMs: main.freshMs, warmMs, retainedKb: main.retainedKb, retainedSmallKb: control.retainedKb,
    keysSeen: main.keysSeen, controlKeys: control.keysSeen, spotOk: main.spotOk && control.spotOk,
});
