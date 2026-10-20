/* oxlint-disable react/globals, carburetor/require-tsdoc */
// A computed's track() mints its per-source recorder and encoded id once per slot instead of
// on every call; every write still recomputes the body, delivers once and reaches the exact
// final value, while an unrelated store stays silent. Args: [tracks=200] [cycles=40]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const tracks = Number(process.argv[2] ?? 200);
const cycles = Number(process.argv[3] ?? 40);
const stores = Array.from({length: 2}, (_, index) => new Carburetor({n: index}));
const noise = new Carburetor({n: -1});

const computedProto = Object.getPrototypeOf(computed(() => 0));
const symbols = Object.getOwnPropertySymbols(computedProto);
const recorderKey = symbols.find(symbol => symbol.description === 'computed.createReadRecorder');
if (recorderKey === undefined) throw new Error('computed.createReadRecorder symbol not found');

let bodyRuns = 0;
let notified = 0;
let lastDelivered = undefined;
const fanIn = computed(read => {
    bodyRuns++;
    let local = 0;
    for (let index = 0; index < tracks; index++) {
        local += read(stores[index % 2]).n;
    }
    return local;
});
fanIn.subscribe(() => {
    notified++;
    lastDelivered = fanIn.get();
});

// The subscription's first recompute mints the per-source slots; the counted window covers
// only steady-state recomputes, whose track calls must reuse the filed recorders.
let recorders = 0;
const rawRecorder = computedProto[recorderKey];
computedProto[recorderKey] = function (...args) {
    recorders++;
    return rawRecorder.apply(this, args);
};

try {
    // cycle + 1 always differs from the seed values (0 and 1), so every write recomputes.
    for (let cycle = 0; cycle < cycles; cycle++) {
        stores[cycle % 2].update(draft => { draft.n = cycle + 1; });
    }
    // An unrelated write must not wake or recompute this computed at all.
    const before = {bodyRuns, notified};
    noise.update(draft => { draft.n = 5; });
    var irrelevantDelta = {bodyRuns: bodyRuns - before.bodyRuns, notified: notified - before.notified};
} finally {
    computedProto[recorderKey] = rawRecorder;
}
const finalValue = fanIn.get();
// Final seeds: the even store ends at `cycles - 1`, the odd one at `cycles`; the body sums
// each store exactly `tracks / 2` times.
const expectedFinal = (tracks / 2) * ((cycles - 1) + cycles);

emit({
    tracks, requestedCycles: cycles, bodyRuns, notified, recorders,
    irrelevantBodyRuns: irrelevantDelta.bodyRuns, irrelevantNotified: irrelevantDelta.notified,
    finalValue, expectedFinal,
    lastDelivered,
    deliveryExact: lastDelivered === expectedFinal,
    done: bodyRuns === cycles + 1 && notified === cycles
        && irrelevantDelta.bodyRuns === 0 && irrelevantDelta.notified === 0
        && finalValue === expectedFinal && lastDelivered === expectedFinal,
});
