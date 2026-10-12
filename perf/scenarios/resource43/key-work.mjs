/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, encoded} from './fixture.mjs';
let loaderCalls = 0;
const unused = () => { loaderCalls++; throw new Error('lookup called loader'); };
const original = JSON.stringify;
let calls = 0;
function measure(fn) {
    calls = 0;
    JSON.stringify = function(...args) { calls++; return original.apply(this, args); };
    try { fn(); return calls; } finally { JSON.stringify = original; }
}
const objectCache = new api.ResourceCache(unused, {keyCacheSize: 2});
const query = {id: 'a.b~c', filters: [1, 2]};
const expectedKey = '{"id":"a~1b~0c","filters":[1,2]}';
const expectedPath = 'entries.{"id":"a~01b~00c","filters":[1,2]}';
const objectStringifies = measure(() => {
    for (let i = 0; i < 16; i++) {
        const r = objectCache.resolve(query);
        assert.equal(r.key, expectedKey); assert.equal(r.path, expectedPath);
        assert.equal(r.present, false); assert.equal(r.view.data, undefined);
    }
});
assert.equal(objectStringifies, 16, 'mutable objects must serialize on every call');
const freshObjectStringifies = measure(() => {
    for (let i = 0; i < 16; i++) assert.equal(objectCache.resolve({id: 'a.b~c', filters: [1, 2]}).key, expectedKey);
});
const reports = [];
const error = console.error;
const mutable = {id: 'before'};
const mutationCache = new api.ResourceCache(unused);
let mutationWarnings;
try {
    console.error = (...args) => reports.push(args.map(String).join(' '));
    mutationCache.resolve(mutable);
    mutable.id = 'after';
    assert.equal(mutationCache.resolve(mutable).key, '{"id":"after"}');
    mutable.id = 'third';
    assert.equal(mutationCache.resolve(mutable).key, '{"id":"third"}');
    mutationWarnings = reports.filter(text => text.includes('mutated')).length;
    assert.equal(reports.length, mutationWarnings, 'no unrelated diagnostic may be swallowed');
    assert.equal(mutationWarnings, process.env.NODE_ENV === 'production' ? 0 : 1);
} finally { console.error = error; }
function budget(size, traffic) {
    const cache = new api.ResourceCache(unused, {keyCacheSize: size});
    return measure(() => {
        for (const value of traffic) {
            const r = cache.resolve(value);
            // Compute oracle with saved stringify, not the instrumented function.
            const key = original(value === undefined ? null : value).replaceAll('~', '~0').replaceAll('.', '~1');
            assert.equal(r.key, key); assert.equal(r.present, false);
        }
    });
}
const emptyStringifies = budget(2, []);
const disabledStringifies = budget(0, ['a', 'a', 'b', 'b']);
const budgetOneStringifies = budget(1, ['a', 'b', 'a', 'b']);
// Intrusive LRU promotion matters: hit a promotes it, c evicts b, a remains a hit.
const lruStringifies = budget(2, ['a', 'b', 'a', 'c', 'a', 'b']);
const withinBudgetStringifies = budget(2, ['a', 'b', 'a', 'b', 'a', 'b']);
assert.deepEqual([emptyStringifies, disabledStringifies, budgetOneStringifies, lruStringifies, withinBudgetStringifies], [0, 4, 4, 4, 2]);
assert.equal(encoded(undefined), 'null');
emit({objectStringifies, freshObjectStringifies, mutationWarnings, emptyStringifies,
    disabledStringifies, budgetOneStringifies, lruStringifies, withinBudgetStringifies,
    loaderCalls, keysOk: true, done: true});
