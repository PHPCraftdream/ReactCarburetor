import {emit, load} from '../../harness/lib.mjs';
import {snapshot, intact, pairCount, covers} from './snapshots.mjs';
import {countPartWork, counterControls} from './part-work.mjs';

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
    return {sources, inputs, total, initial,
        bump() { sources[0].update(draft => { draft[shared ? 'p0' : 'p']++; }); return total.get(); },
        counts: () => ({leafRuns, bodyRuns, deliveries, deliveryChecksum}),
        close() { total.unsubscribe(id); }};
};
const control = counterControls();
const measured = fixture();
let work;
let snapshotsIntact;
let finalPairs;
let pairCoverage;
let counts;
let noiseQuiet;
try {
    const saved = [measured.total, ...measured.inputs].map(snapshot);
    work = countPartWork(() => measured.bump());
    snapshotsIntact = saved.every(intact);
    finalPairs = pairCount(measured.total);
    pairCoverage = covers(measured.total, measured.inputs);
    counts = measured.counts();
    const before = measured.counts();
    measured.sources[0].update(draft => { draft.noise = 1; });
    measured.total.get();
    const after = measured.counts();
    noiseQuiet = before.leafRuns === after.leafRuns && before.bodyRuns === after.bodyRuns
        && before.deliveries === after.deliveries;
} finally { measured.close(); }
emit({K, M, shared, initial: measured.initial, current: work.value,
    iteratorRefs: work.iteratorRefs, copyRefs: work.copyRefs, appendRefs: work.appendRefs, partRefs: work.partRefs,
    finalPairs, pairCoverage, snapshotsIntact, bodyRuns: counts.bodyRuns, leafRuns: counts.leafRuns,
    deliveries: counts.deliveries, deliveryChecksum: counts.deliveryChecksum, noiseQuiet,
    emptyRefs: control.empty, spreadControlRefs: control.spread, appendControlRefs: control.append,
    copyControlRefs: control.copy, methodsCovered: control.covered, done: true});
