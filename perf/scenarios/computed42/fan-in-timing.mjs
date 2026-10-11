import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor, computed} = await load();
const K = Number(process.argv[2] ?? 100);
const shared = (process.argv[3] ?? 'shared') === 'shared';
if (![100, 400, 1600].includes(K)) throw new Error('K must be 100, 400 or 1600');
const M = 1;
const fixture = () => {
    const sources = shared
        ? [new Carburetor(Object.fromEntries(Array.from({length: K}, (_, index) => ['p' + index, index])))]
        : Array.from({length: K}, (_, index) => new Carburetor({p: index}));
    let leafRuns = 0;
    let bodyRuns = 0;
    let deliveries = 0;
    let deliveryChecksum = 0;
    const inputs = Array.from({length: K}, (_, index) => computed(read => {
        leafRuns++;
        return read(sources[shared ? 0 : index])[shared ? 'p' + index : 'p'];
    }));
    const total = computed(read => {
        bodyRuns++;
        let sum = 0;
        for (const input of inputs) sum += read(input);
        return sum;
    });
    const id = total.subscribe(() => { deliveries++; deliveryChecksum += total.get(); });
    const initial = total.get();
    return {sources, total, initial,
        bump() { sources[0].update(draft => { draft[shared ? 'p0' : 'p']++; }); return total.get(); },
        counts: () => ({leafRuns, bodyRuns, deliveries, deliveryChecksum}),
        close() { total.unsubscribe(id); }};
};
const warmup = 8;
const rounds = 7;
const batch = 16;
const timing = fixture();
const samples = [];
let timingChecksum = 0;
let timingCorrect = true;
let timingCounts;
let timingNoiseQuiet;
try {
    let writes = 0;
    for (let index = 0; index < warmup; index++) {
        const value = timing.bump();
        writes++;
        timingCorrect &&= value === timing.initial + writes;
    }
    const before = timing.counts();
    for (let round = 0; round < rounds; round++) {
        const start = performance.now();
        for (let index = 0; index < batch; index++) {
            const value = timing.bump();
            writes++;
            timingChecksum += value;
            timingCorrect &&= value === timing.initial + writes;
        }
        samples.push((performance.now() - start) / batch);
    }
    const after = timing.counts();
    timingCounts = {bodyRuns: after.bodyRuns - before.bodyRuns, leafRuns: after.leafRuns - before.leafRuns,
        deliveries: after.deliveries - before.deliveries,
        deliveryChecksum: after.deliveryChecksum - before.deliveryChecksum};
    timing.sources[0].update(draft => { draft.noise = 1; });
    timing.total.get();
    const quiet = timing.counts();
    timingNoiseQuiet = quiet.bodyRuns === after.bodyRuns && quiet.leafRuns === after.leafRuns
        && quiet.deliveries === after.deliveries;
} finally { timing.close(); }
emit({K, M, shared, initial: timing.initial,
    warmup, timingWrites: rounds * batch, timingChecksum, timingCorrect,
    timingBodyRuns: timingCounts.bodyRuns, timingLeafRuns: timingCounts.leafRuns,
    timingDeliveries: timingCounts.deliveries, timingDeliveryChecksum: timingCounts.deliveryChecksum,
    timingNoiseQuiet, updateGetMs: median(samples), timingSamplesMs: samples.join(','), done: true});
