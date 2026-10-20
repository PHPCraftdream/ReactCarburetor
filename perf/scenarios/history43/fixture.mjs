/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot} from '../../harness/lib.mjs';

const require = createRequire(import.meta.url);
const esm = resolve(distRoot, 'Carburetor/index.mjs');
const api = existsSync(esm) ? await import(pathToFileURL(esm).href)
    : require(resolve(distRoot, 'Carburetor/index.js'));
export const {CarburetorHistory, transaction} = api;
export class Store extends api.Carburetor {
    run(fn) { this.update(fn); }
}
export class ManualThrottle extends api.ComponentUpdateThrottle {
    setupTimeout() {}
    flush() { this.letsUpdate(); }
}
export class MeterHistory extends CarburetorHistory {
    gate = false;
    checks = 0;
    taps = [];
    onPatch(patch) {
        if (typeof patch !== 'symbol' && (patch.previous === null || typeof patch.previous !== 'object')
            && (patch.next === null || typeof patch.next !== 'object')) {
            const descriptor = Object.getOwnPropertyDescriptor(patch, 'nextExists');
            assert.ok(descriptor && 'value' in descriptor && descriptor.configurable);
            const owner = this;
            Object.defineProperty(patch, 'nextExists', {
                enumerable: descriptor.enumerable, configurable: descriptor.configurable,
                get() { if (owner.gate) owner.checks++; return descriptor.value; },
            });
            this.taps.push([patch, descriptor]);
        }
        this.gate = true;
        try { return super.onPatch(patch); } finally { this.gate = false; }
    }
    restoreTaps() {
        for (const [patch, descriptor] of this.taps) {
            Object.defineProperty(patch, 'nextExists', descriptor);
            assert.deepEqual(Object.getOwnPropertyDescriptor(patch, 'nextExists'), descriptor);
        }
        this.taps = [];
    }
}
export function fixture(p, unrelated, mode, History = CarburetorHistory) {
    const throttle = mode === 'manual-throttle' ? new ManualThrottle() : undefined;
    const store = new Store({rows: Array.from({length: p}, () => ({n: 0})),
        spare: {n: 0}, padding: Array.from({length: unrelated}, (_, n) => ({n}))}, throttle);
    const history = new History(store, {limit: p + 2});
    const flush = () => throttle?.flush();
    const write = value => {
        if (mode === 'one-update') store.run(d => { for (const row of d.rows) row.n = value; });
        else {
            const edits = () => {
                for (let i = 0; i < p; i++) store.run(d => { d.rows[i].n = value; });
            };
            if (mode === 'transaction') transaction(edits); else edits();
        }
        flush();
    };
    return {store, history, flush, write};
}
export function ownedControl() {
    const store = new Store({slot: null, keep: {n: 7}});
    const history = new CarburetorHistory(store);
    try {
        store.run(d => { d.slot = {child: {n: 1}}; d.slot.child.n = 2; });
        assert.equal(history.past.at(-1).patches.length, 1);
        const endpoint = history.past.at(-1).patches[0].next;
        assert.notEqual(endpoint, store.getData().slot);
        assert.equal(endpoint.child.n, 2);
        assert.equal(history.undo(), true);
        assert.equal(store.getData().slot, null);
        assert.equal(history.redo(), true);
        assert.equal(store.getData().slot.child.n, 2);
        store.run(d => {
            d.slot = {child: {n: 3}};
            d.slot.child = null;
            d.slot.child = {n: 4};
            d.slot.child.n = 5;
        });
        assert.equal(history.undo(), true);
        assert.equal(store.getData().slot.child.n, 2);
        assert.equal(history.redo(), true);
        assert.equal(store.getData().slot.child.n, 5);
        assert.equal(endpoint.child.n, 2);
        assert.equal(store.getData().keep.n, 7);
        return true;
    } finally { history.disconnect(); }
}
