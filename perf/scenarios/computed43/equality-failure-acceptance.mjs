import assert from 'node:assert/strict';
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor, computed, transaction} = await load();
const token = value => value[Symbol.for('react-carburetor/v1/computed-snapshot-version')]();
const rows = [];
for (const shape of ['array', 'scalar', 'undefined', 'same-content']) {
    for (const accept of [true, false]) {
        for (const recover of [false, true]) {
            const store = new Carburetor({n: 1});
            const error = new Error('computed43 comparator');
            const bodyError = new Error('computed43 body');
            let poison = true;
            let bodyPoison = false;
            let bodies = 0;
            const comparisons = [];
            const result = n => shape === 'array' ? [n] : shape === 'same-content' ? [n % 2]
                : shape === 'undefined' && n === 1 ? undefined : n;
            const value = computed(read => {
                bodies++;
                const n = read(store).n;
                if (bodyPoison) throw bodyError;
                return result(n);
            }, {equals: (before, after) => {
                comparisons.push([before, after]);
                if (poison) throw error;
                return accept;
            }});
            const baseline = value.get();
            assert.equal(bodies, 1);
            assert.equal(comparisons.length, 0);
            assert.equal(token(value), 0);
            store.update(draft => { draft.n = shape === 'same-content' ? 3 : 2; });
            for (let i = 0; i < 2; i++) {
                assert.throws(() => value.get(), caught => caught === error);
                assert.equal(token(value), 0);
                assert.equal(value.getVersion(), 0);
            }
            assert.ok(comparisons.length >= 2);
            const calls = comparisons.length;
            bodyPoison = true;
            for (let i = 0; i < 2; i++) assert.throws(() => value.get(), caught => caught === bodyError);
            assert.equal(comparisons.length, calls);
            assert.equal(token(value), 0);
            bodyPoison = false;
            if (recover) {
                poison = false;
                const accepted = value.get();
                assert.equal(accepted, accept ? baseline : comparisons.at(-1)[1]);
                assert.equal(token(value), accept ? 0 : 1);
                assert.equal(value.getVersion(), 0);
                const stableBodies = bodies;
                const stableCalls = comparisons.length;
                for (let i = 0; i < 64; i++) assert.equal(value.get(), accepted);
                assert.equal(bodies, stableBodies);
                assert.equal(comparisons.length, stableCalls);
            } else {
                assert.throws(() => value.get(), caught => caught === error);
                assert.equal(token(value), 0);
            }
            for (const [before, after] of comparisons) {
                assert.equal(before, baseline);
                assert.deepEqual(after, result(shape === 'same-content' ? 3 : 2));
                if (Array.isArray(after)) assert.notEqual(after, baseline);
            }
            rows.push({shape, accept, recover, bodies, calls: comparisons.length});
        }
    }
}
for (const accept of [true, false]) {
    const store = new Carburetor({n: 1});
    const comparisons = [];
    const events = [];
    let bodies = 0;
    const value = computed(read => { bodies++; return [read(store).n]; }, {
        equals: (before, after) => { comparisons.push([before, after]); return accept; },
    });
    const id = value.subscribe(() => events.push(value.get()));
    try {
        const baseline = value.get();
        assert.equal(comparisons.length, 0);
        transaction(() => {
            store.update(draft => { draft.n = 2; });
            assert.deepEqual(value.get(), [2]);
            assert.equal(token(value), 0);
            assert.equal(comparisons.length, 0);
            assert.equal(events.length, 0);
        });
        assert.equal(comparisons.length, 1);
        assert.equal(comparisons[0][0], baseline);
        assert.deepEqual(comparisons[0][1], [2]);
        const expected = accept ? baseline : comparisons[0][1];
        assert.equal(value.get(), expected);
        assert.equal(token(value), accept ? 0 : 1);
        assert.equal(value.getVersion(), accept ? 0 : 1);
        assert.deepEqual(events, accept ? [] : [expected]);
        for (let i = 0; i < 64; i++) assert.equal(value.get(), expected);
        assert.equal(bodies, 2);
        assert.equal(comparisons.length, 1);
        rows.push({shape: 'observed', accept, bodies, calls: comparisons.length});
    } finally { value.unsubscribe(id); }
}
for (const accept of [true, false]) {
    const store = new Carburetor({n: 1});
    let bodies = 0;
    const comparisons = [];
    const value = computed(read => { bodies++; return [read(store).n]; }, {
        equals: (before, after) => { comparisons.push([before, after]); return accept; },
    });
    const baseline = value.get();
    assert.equal(comparisons.length, 0);
    store.update(draft => { draft.n = 2; });
    const accepted = value.get();
    assert.equal(comparisons.length, 1);
    assert.equal(comparisons[0][0], baseline);
    assert.deepEqual(comparisons[0][1], [2]);
    assert.equal(accepted, accept ? baseline : comparisons[0][1]);
    assert.equal(token(value), accept ? 0 : 1);
    assert.equal(value.getVersion(), 0);
    for (let i = 0; i < 64; i++) assert.equal(value.get(), accepted);
    assert.equal(bodies, 2);
    assert.equal(comparisons.length, 1);
    rows.push({shape: 'successful-unobserved', accept, bodies, calls: comparisons.length});
}
{
    const store = new Carburetor({n: 1});
    const error = new Error('independent body failure');
    let poison = false;
    const value = computed(read => {
        const n = read(store).n;
        if (poison) throw error;
        return n;
    });
    assert.equal(value.get(), 1);
    poison = true;
    store.update(draft => { draft.n = 2; });
    for (let i = 0; i < 2; i++) {
        assert.throws(() => value.get(), caught => caught === error);
        assert.equal(token(value), 0);
        assert.equal(value.getVersion(), 0);
    }
    poison = false;
    assert.equal(value.get(), 2);
    assert.equal(token(value), 1);
    assert.equal(value.getVersion(), 0);
    rows.push({shape: 'independent-body-error'});
}
let emptyBodies = 0;
let emptyCalls = 0;
const empty = computed(() => { emptyBodies++; return undefined; }, {
    equals: () => { emptyCalls++; throw new Error('empty comparator'); },
});
for (let i = 0; i < 64; i++) assert.equal(empty.get(), undefined);
const emptyId = empty.subscribe(() => { throw new Error('empty delivery'); });
try { assert.equal(empty.get(), undefined); }
finally { empty.unsubscribe(emptyId); }
assert.equal(emptyBodies, 1);
assert.equal(emptyCalls, 0);
emit({caseCount: rows.length + 1, emptyBodies, emptyCalls, acceptanceCorrect: true,
    exactErrors: true, exactArguments: true, tokensCorrect: true, cachedQuiet: true,
    observedCorrect: true, evidence: JSON.stringify(rows), done: true});
