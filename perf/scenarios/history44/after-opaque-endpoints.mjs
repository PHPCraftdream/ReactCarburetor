import assert from 'node:assert/strict';
import {emit} from '../../harness/lib.mjs';
import {api, opaqueFixture} from './fixture.mjs';

class Meter extends api.CarburetorHistory {
    /** Reflection visits inside history patch callbacks. */
    visits = 0;
    /** Visits after the irrevocable snapshot boundary. */
    afterOpaqueVisits = 0;
    /** Delivered writer events including structural symbols. */
    events = 0;
    /** Reachable unused endpoint nodes immediately after the first opaque callback returns. */
    cutoverUnusedOwnedNodes = 0;
    /** Graph nodes still owned by pending endpoints at the protected entry boundary. */
    unusedOwnedNodes = 0;
    /** Positive live ownership before cutover, independent of reflection work counts. */
    preCutoverOwnedNodes = 0;
    /** Traverses concrete endpoint graphs, not pending record count or copy identities.
     *
     * This synchronous census establishes reachability from the recorder's protected
     * ownership roots only; it makes no collectibility, GC or heap-byte claim.
     */
    ownedNodes() {
        const seen = new Set();
        const visit = value => {
            if (value === null || typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            for (const key of Reflect.ownKeys(value)) {
                const field = Object.getOwnPropertyDescriptor(value, key);
                if (field && 'value' in field) visit(field.value);
            }
        };
        for (const patch of this.pendingPatches) {
            if (patch.previousExists) visit(patch.previous);
            if (patch.nextExists) visit(patch.next);
        }
        return seen.size;
    }
    /** Observes ownership before authoritative capture and before record cleanup.
     *
     * @param fact - the closed source publication
     */
    buildEntry(fact) {
        if (this.pendingOpaque) this.unusedOwnedNodes = this.ownedNodes();
        return super.buildEntry(fact);
    }
    /** Counts only history endpoint work, excluding the independent writer and final capture. */
    onPatch(patch) {
        const opaque = this.pendingOpaque;
        const original = Reflect.ownKeys;
        let visits = 0;
        Reflect.ownKeys = value => { visits++; return original(value); };
        try { super.onPatch(patch); }
        finally { Reflect.ownKeys = original; }
        // Census is outside reflection instrumentation and before any later patch/publication.
        if (!opaque && this.pendingOpaque) this.cutoverUnusedOwnedNodes = this.ownedNodes();
        this.visits += visits;
        if (opaque) this.afterOpaqueVisits += visits;
        this.events++;
        if (!this.pendingOpaque) this.preCutoverOwnedNodes = Math.max(this.preCutoverOwnedNodes, this.ownedNodes());
    }
}
const n = Number(process.argv[2] ?? 32);
const k = Number(process.argv[3] ?? 3);
const padding = Number(process.argv[4] ?? 32);
const mode = process.argv[5] ?? 'native-first';
const saved = Reflect.ownKeys;
const {store, history, write} = opaqueFixture(n, k, padding, mode, Meter);
let wakes = 0, spare = 0, writerEvents = 0;
const id = store.subscribe(() => wakes++);
const stop = store.watch(d => d.keep, () => spare++);
const dispose = store.attachPatchListener({patch: patch => {
    if (typeof patch !== 'symbol') writerEvents++;
}});
try {
    write();
    const afterOpaqueVisits = history.afterOpaqueVisits;
    const visits = history.visits;
    const events = history.events;
    const cutoverUnusedOwnedNodes = history.cutoverUnusedOwnedNodes;
    const unusedOwnedNodes = history.unusedOwnedNodes;
    const preCutoverOwnedNodes = history.preCutoverOwnedNodes;
    const originalWriterEvents = writerEvents;
    if (mode === 'noop') {
        assert.equal(history.canUndo(), false);
        assert.equal(wakes, 0);
        assert.equal(events, 0);
    } else {
        assert.equal(store.getData().slot.rows[0].n, k);
        assert.equal(history.undo(), true);
        assert.equal(store.getData().slot, null);
        assert.equal(store.getData().stamp, null);
        assert.equal(history.redo(), true);
        assert.equal(store.getData().slot.rows[0].n, k);
        if (mode !== 'plain') assert.equal(store.getData().stamp.getTime(), 1000);
        assert.equal(wakes, 3);
    }
    assert.equal(spare, 0);
    assert.equal(store.getData().padding.length, padding);
    assert.equal(Reflect.ownKeys, saved);
    const control = opaqueFixture(4, 1, 0, 'plain', Meter);
    let positiveVisits, positiveOwnedNodes;
    try {
        control.write(); positiveVisits = control.history.visits;
        positiveOwnedNodes = control.history.preCutoverOwnedNodes;
        assert.ok(positiveOwnedNodes >= 6);
    }
    finally { control.history.disconnect(); }
    emit({n, k, padding, mode, afterOpaqueVisits, visits, events,
        writerEvents: originalWriterEvents, cutoverUnusedOwnedNodes, unusedOwnedNodes,
        preCutoverOwnedNodes, positiveOwnedNodes,
        positiveVisits, intrinsicsRestored: Reflect.ownKeys === saved,
        endpointsCorrect: true, publicationCorrect: true, spare});
} finally { dispose(); stop(); store.unsubscribe(id); history.disconnect(); }
