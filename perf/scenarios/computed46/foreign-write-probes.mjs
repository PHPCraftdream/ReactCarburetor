/* oxlint-disable react/globals, carburetor-internal/require-tsdoc */
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const HAS_DRIFT = Symbol.for('react-carburetor/v1/subscription-has-drift');
class Store extends Carburetor { run(fn) { this.update(fn); } }

const fanIn = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(fanIn) || fanIn < 1) throw new Error('F must be a positive integer');
const store = new Store({items: Array.from({length: fanIn}, (_, index) => index), noise: 0});
const foreign = new Store({noise: 0});
let probes = 0;
const original = store[HAS_DRIFT];
store[HAS_DRIFT] = function (...args) {
    probes++;
    return original.apply(this, args);
};
let recomputes = 0;
const leaves = Array.from({length: fanIn}, (_, index) => computed(read => read(store).items[index]));
const total = computed(read => {
    recomputes++;
    let sum = 0;
    for (const leaf of leaves) sum += read(leaf);
    return sum;
});
const id = total.subscribe(() => undefined);
const initial = fanIn * (fanIn - 1) / 2;
let relatedProbeCount;
let foreignProbeCount;
let recomputeDelta;
let valueAfterRelated;
try {
    if (total.get() !== initial) throw new Error('initial value mismatch');
    const beforeBoth = recomputes;
    probes = 0;
    store.run(draft => { draft.noise++; });
    if (total.get() !== initial) throw new Error('same-store noise value mismatch');
    relatedProbeCount = probes;
    probes = 0;
    foreign.run(draft => { draft.noise++; });
    if (total.get() !== initial) throw new Error('foreign noise value mismatch');
    foreignProbeCount = probes;
    recomputeDelta = recomputes - beforeBoth;
    store.run(draft => { draft.items[0]++; });
    valueAfterRelated = total.get();
} finally {
    total.unsubscribe(id);
}
const expected = initial + 1;
emit({fanIn, probesAfterUnrelatedSameStore: relatedProbeCount,
    probesAfterForeignWrite: foreignProbeCount, recomputes: recomputeDelta,
    valueAfterRelated, correctness: valueAfterRelated === expected, done: valueAfterRelated === expected});
