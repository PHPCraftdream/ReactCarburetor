/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R6-04: subscribe() copies a public read set, so a later caller mutation cannot desynchronize
// matching, and re-subscribing with a grown set files the growth; the internal transferReads
// path adopts the caller's set with no copy — its retained bookkeeping per subscriber stays
// below the copying public path. Args: [count=4000] [samples=9]
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const count = Number(process.argv[2] ?? 4000);
const samples = Number(process.argv[3] ?? 9);

// A set mutated after subscribing must not change what the subscription matches.
const mutation = new S({a: 0, b: 0});
const mine = new Set(['a']);
let mutationWakes = 0;
mutation.subscribe(() => { mutationWakes++; }, {id: 'x', reads: mine});
mine.add('b');
mutation.run(draft => { draft.b = 1; });
const callerMutationWakes = mutationWakes;

// Re-subscribing the same id with the grown set must file the growth (the pre-copy engine
// adopted the set by reference and left the index without it).
mutation.subscribe(() => { mutationWakes++; }, {id: 'x', reads: mine});
mutationWakes = 0;
mutation.run(draft => { draft.b = 2; });
const grownReadsWake = mutationWakes;

// A frozen read set is accepted and works: the engine never mutates the caller's copy.
const frozen = new S({a: 0});
let frozenWakes = 0;
frozen.subscribe(() => { frozenWakes++; }, {id: 'f', reads: Object.freeze(new Set(['a']))});
frozen.run(draft => { draft.a = 1; });

// Public subscribe cost at count subscribers, 3-path sets: the copy is the accepted cost.
const readsFor = i => new Set([`items.item${i}.title`, `items.item${i}.done`, `order.${i}`]);
const timed = new S({items: {}, order: []});
const times = [];
for (let round = 0; round < samples; round++) {
    const ids = [];
    const start = performance.now();
    for (let i = 0; i < count; i++) {
        ids.push(timed.subscribe(() => undefined, {id: 's' + i, reads: readsFor(i)}));
    }
    times.push(performance.now() - start);
    for (const id of ids) {
        timed.unsubscribe(id);
    }
}

// The internal transferReads path (absent on pre-R6 builds: metrics report -1 there).
let transferReads;
try {
    transferReads = (await loadPath('Carburetor/Store/Paths/Markers/transferReads.mjs')).transferReads;
} catch {
    transferReads = undefined;
}
let transferWakes = -1;
if (transferReads) {
    transferWakes = 0;
    const adopted = new S({items: {a: {title: ''}}});
    adopted.subscribe(() => { transferWakes++; }, transferReads(new Set(['items.a.title']), 't'));
    adopted.run(draft => { draft.items.a.title = 'x'; });
}
const bytesPerSubscriber = useTransfer => {
    const heapStore = new S({items: {}, order: []});
    global.gc?.();
    global.gc?.();
    const before = process.memoryUsage().heapUsed;
    const retained = [];
    for (let i = 0; i < count; i++) {
        const reads = readsFor(i);
        retained.push(reads);
        heapStore.subscribe(() => undefined, useTransfer
            ? transferReads(reads, 'm' + i)
            : {id: 'm' + i, reads});
    }
    global.gc?.();
    global.gc?.();
    if (retained.length !== count || heapStore.getVersion() < 0) throw new Error('unreachable');
    return (process.memoryUsage().heapUsed - before) / count;
};
const heapMedian = useTransfer => median(Array.from({length: 3}, () => bytesPerSubscriber(useTransfer)));
const publicBytes = transferReads ? heapMedian(false) : -1;
const transferBytes = transferReads ? heapMedian(true) : -1;

emit({callerMutationWakes, grownReadsWake, frozenReadsWake: frozenWakes, subscribeMs: median(times),
    transferWakes, publicBytes, transferBytes});
