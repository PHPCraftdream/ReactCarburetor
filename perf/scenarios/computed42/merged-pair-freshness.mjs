import {emit, load} from '../../harness/lib.mjs';
import {snapshot, intact, pairCount, covers} from './snapshots.mjs';

const {Carburetor, computed, transaction} = await load();
const cases = [];
const run = (shape, reverse, observed, field) => {
    const store = new Carburetor({a: 1, b: 2, c: 3, d: 4, noise: 0});
    const runs = Array(7).fill(0);
    const leaves = ['a', 'b', 'c', 'd'].map((key, index) => computed(read => {
        runs[index]++;
        return read(store)[key];
    }));
    const left = computed(read => { runs[4]++; return read(leaves[0]) + read(leaves[1]); });
    const right = computed(read => { runs[5]++; return read(leaves[2]) + read(leaves[3]); });
    const total = computed(read => {
        runs[6]++;
        if (shape === 'flat') return leaves.reduce((sum, leaf) => sum + read(leaf), 0);
        if (shape === 'bare') return read(left) + read(leaves[2]) + read(leaves[3]);
        return reverse ? read(right) + read(left) : read(left) + read(right);
    });
    const deliveries = [];
    const id = observed ? total.subscribe(() => deliveries.push(total.get())) : undefined;
    try {
        const initial = total.get();
        const count = pairCount(total);
        const saved = [total, left, right, ...leaves].map(value => {
            value.get();
            return snapshot(value);
        });
        const before = runs.slice();
        const expected = field === 'noise' ? 10 : 20;
        let eager;
        let pending = 0;
        const change = () => {
            store.update(draft => { draft[field] += 10; });
            eager = total.get();
            pending = deliveries.length;
        };
        if (observed) transaction(change); else change();
        const after = total.get();
        const stable = total.get();
        const deltas = runs.map((value, index) => value - before[index]);
        const coverage = covers(total, leaves);
        const snapshots = saved.every(intact);
        const noiseBefore = runs.slice();
        const deliveryBefore = deliveries.length;
        store.update(draft => { draft.noise++; });
        const noise = total.get();
        const quiet = runs.every((value, index) => value === noiseBefore[index])
            && deliveries.length === deliveryBefore && noise === expected;
        const expectedDeliveries = observed && field !== 'noise' ? [expected] : [];
        const bodies = field === 'noise' ? deltas.every(value => value === 0)
            : deltas[6] === 1
                && deltas.slice(0, 4).every((value, index) => value === (field === 'abcd'[index] ? 1 : 0));
        return {shape, reverse, observed, field, initial, expected, eager, after, stable, pending,
            deliveries: deliveries.join(','), count, coverage, deltas: deltas.join(','), snapshots, quiet, bodies,
            fresh: initial === 10 && eager === expected && after === expected && stable === expected,
            delivery: pending === 0 && deliveries.join(',') === expectedDeliveries.join(',')};
    } finally {
        if (id !== undefined) total.unsubscribe(id);
    }
};
for (const reverse of [false, true]) {
    for (const observed of [false, true]) {
        for (const field of ['a', 'b', 'c', 'd', 'noise']) cases.push(run('merged', reverse, observed, field));
    }
}
for (const shape of ['flat', 'bare']) {
    for (const observed of [false, true]) {
        for (const field of ['a', 'c', 'noise']) cases.push(run(shape, false, observed, field));
    }
}
emit({caseCount: cases.length, freshness: cases.every(value => value.fresh),
    deliveriesCorrect: cases.every(value => value.delivery), noiseQuiet: cases.every(value => value.quiet),
    bodiesCorrect: cases.every(value => value.bodies), snapshotsIntact: cases.every(value => value.snapshots),
    completePairs: cases.every(value => value.count === 4 && value.coverage),
    checksum: cases.reduce((sum, value) => sum + value.eager + value.after + value.stable, 0),
    evidence: JSON.stringify(cases), done: true});
