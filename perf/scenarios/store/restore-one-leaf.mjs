/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R34-04: restore() of a snapshot that differs from the live state in one leaf wraps only the
// changed row in a draft proxy (counted exactly), next to the cost of taking that snapshot.
// Args: [rows=10000] [samples=9]
import {emit, load, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor { run(fn) { this.update(fn); } }

const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 9);
const s = new S({rows: Array.from({length: rows}, (_, id) => ({id, title: `Row ${id}`, done: false, tags: {a: id}}))});
let wakes = 0;
s.subscribe(() => { wakes++; }, {reads: ['rows.5.done']});

// Mechanism counter: Proxy creations wrapping row objects. Restore of one changed leaf is
// O(changed): the cold restore wraps exactly one row (pre-R34 wrapped every row); later samples reuse the cached draft proxies, so the maximum across samples is the count.
const OriginalProxy = globalThis.Proxy;
let rowWraps = 0;
globalThis.Proxy = function (target, handler) {
    if (target !== null && typeof target === 'object' && !Array.isArray(target)
        && Object.prototype.hasOwnProperty.call(target, 'id')) rowWraps++;
    return new OriginalProxy(target, handler);
};
Object.assign(globalThis.Proxy, {revocable: OriginalProxy.revocable});
globalThis.Proxy.prototype = OriginalProxy.prototype;
let readRowWraps = 0;
let restoreRowWraps = 0;
const restore = [];
const snapshot = [];
try {
    // Control: the counter sees the engine wrap a row through a read view.
    void s.read(() => undefined).rows[5].id;
    readRowWraps = rowWraps;
    global.gc?.();
    for (let i = 0; i < samples; i++) {
        let start = performance.now();
        const snap = s.snapshot();
        snapshot.push(performance.now() - start);
        snap.rows[5].done = !snap.rows[5].done;
        rowWraps = 0;
        start = performance.now();
        s.restore(snap);
        restore.push(performance.now() - start);
        restoreRowWraps = Math.max(restoreRowWraps, rowWraps);
    }
} finally {
    globalThis.Proxy = OriginalProxy;
}
emit({
    restoreMs: median(restore), snapshotMs: median(snapshot), restoreRowWraps, readRowWraps,
    wakes, done: s.getData().rows[5].done,
});
