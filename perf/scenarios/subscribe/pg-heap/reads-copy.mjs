/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R6-04 no-added-copy control: no historical internal-copy separation is established.
// Count only Set constructions whose iterable is one of the fixture's read sets.
import {emit, load, loadPath} from '../../../harness/lib.mjs';
const {Carburetor} = await load();
const {transferReads} = await loadPath('Carburetor/Store/Paths/Markers/transferReads.mjs');
const count = 4000;
const sets = Array.from({length: count}, (_, i) => new Set([`a${i}.x`, `b${i}.x`, `c${i}.x`]));
const tracked = new WeakSet(sets);
const stores = Array.from({length: 3}, () => new Carburetor({a0: {x: 0}}));
const NativeSet = globalThis.Set;
let copies = 0;
const window = fn => {
    copies = 0;
    try { fn(); return copies; } finally { copies = 0; }
};
let idleCopies;
let internalCopies;
let publicCopies;
let negativeCopies;
let wakes = 0;
try {
    globalThis.Set = new Proxy(NativeSet, {construct(target, args) {
        if (args[0] && tracked.has(args[0])) copies++;
        return Reflect.construct(target, args);
    }});
    idleCopies = window(() => stores[0].getVersion());
    internalCopies = window(() => sets.forEach((reads, i) =>
        stores[0].subscribe(() => { wakes++; }, transferReads(reads, 'i' + i))));
    publicCopies = window(() => sets.forEach((reads, i) =>
        stores[1].subscribe(() => undefined, {id: 'p' + i, reads})));
    // Deliberately regress internal handover by copying each branded set before subscribing.
    negativeCopies = window(() => sets.forEach((reads, i) =>
        stores[2].subscribe(() => undefined, transferReads(new Set(reads), 'n' + i))));
} finally { globalThis.Set = NativeSet; }
stores[0].update(draft => { draft.a0.x = 1; });
const transferWakes = wakes;
stores[0].unsubscribe('i0');
wakes = 0;
stores[0].update(draft => { draft.a0.x = 2; });
emit({internalCopies, publicCopies, negativeCopies, idleCopies, transferWakes,
    unsubscribedWakes: wakes, negativeRejected: negativeCopies > 0, done: stores[0].getData().a0.x === 2});
