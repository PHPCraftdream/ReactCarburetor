/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-04: per-handler path memos must stay bounded by the live key set — a rolling key window
// must not grow the heap as iterations pile up, with or without a persistent read view that
// reads every key once. Args: [iters=200000] [view=0|1] [keys=100]
import {emit, load} from '../../harness/lib.mjs';

const {Carburetor} = await load();
class S extends Carburetor {
    /** Adds key `m<index>` and drops the key falling out of the window. */
    churn(index, keys) {
        this.update(draft => {
            draft.byId['m' + index] = {n: index};
            if (index >= keys) delete draft.byId['m' + (index - keys)];
        });
    }
}

const iters = Number(process.argv[2] ?? 200000);
const withView = (process.argv[3] ?? '0') === '1';
const keys = Number(process.argv[4] ?? 100);
const store = new S({byId: {}});
const view = withView ? store.read(() => undefined) : undefined;

const heap = () => { global.gc(); global.gc(); return process.memoryUsage().heapUsed; };
const marks = [];
let previous = heap();
for (let index = 0; index < iters; index++) {
    store.churn(index, keys);
    if (view) void view.byId['m' + index]?.n;
    if ((index + 1) % (iters / 4) === 0) {
        const now = heap();
        marks.push((now - previous) / 1024);
        previous = now;
    }
}

const data = store.getData().byId;
const held = Object.keys(data).length === keys;
const spotOk = data['m' + (iters - 1)]?.n === iters - 1;
const viewSeesWindow = !withView
    || (Object.keys(view.byId).length === keys && view.byId['m' + (iters - 1)]?.n === iters - 1);
emit({
    driftKb: marks.slice(1).reduce((sum, kb) => sum + kb, 0),
    totalDriftKb: marks.reduce((sum, kb) => sum + kb, 0),
    windowHeld: held, spotOk, viewSeesWindow,
    iters,
});
