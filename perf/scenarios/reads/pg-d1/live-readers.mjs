/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R13-02/03: retained read trees must not add work to primitive writes.
import {emit, load} from '../../../harness/lib.mjs';

const {Carburetor} = await load();
class Store extends Carburetor { change(fn) { this.update(fn); } }
const count = Number(process.argv[2] ?? 1000);
const store = new Store({tick: 0, branch: {value: 7}});
const views = Array.from({length: count}, () => store.read(() => {}));
for (const view of views) void view.branch.value;
let seq = 0;
const apply = draft => { draft.tick = ++seq; };
// Include iterators: the old retirement ledger walks every live cache on each write.
const probe = fn => {
    let calls = 0;
    const saved = [];
    for (const Class of [Map, WeakMap, Set]) {
        for (const key of Reflect.ownKeys(Class.prototype)) {
            if (key === 'constructor') continue;
            const descriptor = Object.getOwnPropertyDescriptor(Class.prototype, key);
            if (typeof descriptor.value !== 'function') continue;
            const original = descriptor.value;
            saved.push([Class.prototype, key, descriptor]);
            Object.defineProperty(Class.prototype, key, {...descriptor, value: function (...args) {
                calls++;
                return Reflect.apply(original, this, args);
            }});
        }
    }
    try { fn(); } finally {
        for (const [prototype, key, descriptor] of saved) Object.defineProperty(prototype, key, descriptor);
    }
    return calls;
};
const idleCalls = probe(() => {});
const controlCalls = probe(() => {
    const map = new Map(); const weak = new WeakMap(); const set = new Set(); const key = {};
    map.set(key, 1); map.get(key); weak.set(key, 1); weak.get(key); set.add(key); set.has(key);
});
const methodCalls = probe(() => { for (let i = 0; i < 2000; i++) store.change(apply); });
emit({methodCalls, idleCalls, controlCalls, readers: views.length,
    done: store.getData().tick === 2000 && views.every(view => view.branch.value === 7)});
