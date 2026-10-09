import assert from 'node:assert/strict';
import {load, emit} from '../../harness/lib.mjs';

const {ResourceCache, EResourceStatus: Status} = await load();
const mode = process.argv[2] ?? 'success';
assert.ok(['success', 'failure'].includes(mode));
const OriginalProxy = globalThis.Proxy;
let counting = false;
let counts;
const reset = () => { counts = {get: 0, set: 0, has: 0, deleteProperty: 0, ownKeys: 0}; };
/** Wrap write handlers while leaving read proxies and engine operations unchanged.
 *
 * @param target - original proxy target.
 * @param handler - original proxy handler.
 */
function SpyProxy(target, handler) {
    const observed = Object.create(handler);
    if (handler.get && handler.set) {
        for (const trap of ['get', 'set', 'has', 'deleteProperty', 'ownKeys']) {
            observed[trap] = (...args) => {
                if (counting) counts[trap]++;
                return handler[trap] ? handler[trap].apply(handler, args) : Reflect[trap](...args);
            };
        }
    }
    return new OriginalProxy(target, observed);
}
const total = value => Object.values(value).reduce((sum, n) => sum + n, 0);
globalThis.Proxy = SpyProxy;
let actual, control;
const now = Date.now;
try {
    Date.now = () => 123456;
    let resolve, reject;
    const cache = new ResourceCache(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const {key} = cache.resolve('a.b~c');
    const request = cache.load('a.b~c');
    const before = cache.snapshot();
    reset();
    counting = true;
    if (mode === 'success') resolve('answer'); else reject(new Error('offline'));
    await request;
    counting = false;
    actual = {...counts};
    const after = cache.snapshot();
    const old = new ResourceCache(() => Promise.resolve('unused'));
    old.restore(before);
    old.update(draft => { draft.entries[key].status = Status.Pending; });
    reset();
    counting = true;
    old.update(draft => {
        if (mode === 'success') {
            draft.entries[key].status = Status.Success;
            draft.entries[key].data = 'answer';
            draft.entries[key].error = undefined;
            draft.entries[key].updatedAt = Date.now();
            draft.entries[key].refreshing = false;
            draft.entries[key].invalidated = false;
            draft.entries[key].failed = false;
        } else {
            draft.entries[key].error = 'offline';
            draft.entries[key].refreshing = false;
            draft.entries[key].failed = true;
            draft.entries[key].status = Status.Error;
        }
    });
    counting = false;
    control = {...counts};
    assert.deepEqual(old.snapshot(), after);
    assert.equal(after.entries[key].status, mode === 'success' ? Status.Success : Status.Error);
    assert.equal(after.entries[key].data, mode === 'success' ? 'answer' : undefined);
    assert.equal(after.entries[key].failed, mode === 'failure');
    assert.equal(after.entries[key].refreshing, false);
    assert.equal(after.entries[key].invalidated, false);
    if (mode === 'failure') assert.equal(cache.getFailure('a.b~c').message, 'offline');
} finally {
    counting = false;
    Date.now = now;
    globalThis.Proxy = OriginalProxy;
}
emit({
    traps: total(actual), controlTraps: total(control),
    gets: actual.get, sets: actual.set, has: actual.has,
    deletes: actual.deleteProperty, ownKeys: actual.ownKeys,
    controlGets: control.get, controlSets: control.set,
    controlHas: control.has, controlDeletes: control.deleteProperty, controlOwnKeys: control.ownKeys,
    correct: true,
});
