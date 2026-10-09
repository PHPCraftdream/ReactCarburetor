/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R7-04: caller-chosen ids live in their own dictionary slot — '__proto__' files an ordinary
// own key (never the dictionary's prototype) and unsubscribe removes it entirely, while
// dictionary built-in names stay usable. Args: [count=1000] [samples=9]
import {emit, load, median, engine} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const count = Number(process.argv[2] ?? 1000);
const samples = Number(process.argv[3] ?? 9);

const store = new S({n: 0});
let protoWakes = 0;
store.subscribe(() => { protoWakes++; }, {id: '__proto__'});
const protoIdFiled = Object.hasOwn(engine(store, 'subscribers'), '__proto__');
const protoSlotIsolated = Object.getPrototypeOf(engine(store, 'subscribers')) === null;
store.run(draft => { draft.n = 1; });
const protoDelivered = protoWakes;
store.unsubscribe('__proto__');
const protoIdGone = !('__proto__' in engine(store, 'subscribers'));
const protoSlotClean = Object.getPrototypeOf(engine(store, 'subscribers')) === null;
store.run(draft => { draft.n = 2; });
const protoWakesAfterUnsubscribe = protoWakes - protoDelivered;

let ctorWakes = 0;
store.subscribe(() => { ctorWakes++; }, {id: 'constructor'});
store.run(draft => { draft.n = 3; });
const ctorDelivered = ctorWakes;
store.unsubscribe('constructor');
store.run(draft => { draft.n = 4; });
const ctorWakesAfterUnsubscribe = ctorWakes - ctorDelivered;

// subscribe/unsubscribe cost at count subscribers, one path each (report-only).
const readsFor = i => new Set([`items.item${i}.title`]);
const times = [];
const untimes = [];
for (let round = 0; round < samples; round++) {
    const fresh = new S({items: {}, order: []});
    const ids = [];
    let start = performance.now();
    for (let i = 0; i < count; i++) {
        ids.push(fresh.subscribe(() => undefined, {id: 's' + i, reads: readsFor(i)}));
    }
    times.push(performance.now() - start);
    start = performance.now();
    for (const id of ids) {
        fresh.unsubscribe(id);
    }
    untimes.push(performance.now() - start);
}
emit({
    protoIdFiled, protoSlotIsolated, protoIdGone, protoSlotClean,
    protoDelivered, protoWakesAfterUnsubscribe,
    ctorDelivered, ctorWakesAfterUnsubscribe,
    subscribeMs: median(times), unsubscribeMs: median(untimes),
});
