import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot} from '../../harness/lib.mjs';

const esm = resolve(distRoot, 'Carburetor/index.mjs');
export const api = existsSync(esm) ? await import(pathToFileURL(esm).href)
    : createRequire(import.meta.url)(resolve(distRoot, 'Carburetor/index.js'));
export class Store extends api.Carburetor {
    /** Completes a public update. */
    run(fn) { this.update(fn); }
}
export class ManualThrottle extends api.ComponentUpdateThrottle {
    /** Leaves delivery under fixture control. */
    setupTimeout() {}
    /** Completes pending delivery. */
    flush() { this.letsUpdate(); }
}
/** Builds independent endpoint and unrelated-state dimensions.
 *
 * @param n - row nodes per endpoint
 * @param k - endpoint insertions
 * @param padding - unrelated graph nodes
 * @param mode - opacity ordering control
 * @param History - history implementation under measurement
 */
export function opaqueFixture(n, k, padding, mode, History = api.CarburetorHistory) {
    const store = new Store({stamp: null, slot: null, keep: 7,
        padding: Array.from({length: padding}, (_, value) => ({value}))});
    const history = new History(store);
    /** Writes alternating owned endpoints without changing unrelated state. */
    const write = () => store.run(d => {
        if (mode === 'noop') return;
        if (mode === 'native-first') d.stamp = new Date(1000);
        for (let i = 1; i <= k; i++) {
            if (i > 1) d.slot = null;
            d.slot = {rows: Array.from({length: n}, (_, row) => ({n: i + row}))};
            if (mode === 'native-middle' && i === 1) d.stamp = new Date(1000);
        }
        if (mode === 'native-last') d.stamp = new Date(1000);
    });
    return {store, history, write};
}
/** Builds scalar paths with independent depth and publication dimensions.
 *
 * @param p - original writes
 * @param depth - nesting below the root
 * @param mode - repeated, distinct or separate writes
 * @param History - history implementation under measurement
 * @param native - include a native-safe baseline control
 */
export function scalarFixture(p, depth, mode, History = api.CarburetorHistory, native = false) {
    let box = mode === 'distinct' ? Object.fromEntries(Array.from({length: p}, (_, i) => ['n' + i, 0])) : {n: 0};
    for (let i = 1; i < depth; i++) box = {child: box};
    const store = new Store({box, spare: 7, stamp: native ? new Date(1000) : null});
    const history = new History(store, {limit: p + 2});
    /** Navigates the original scalar path; no replay compaction. */
    const leaf = d => {
        let target = d.box;
        for (let i = 1; i < depth; i++) target = target.child;
        return target;
    };
    /** Publishes all original writes. */
    const write = () => {
        if (mode === 'separate') {
            for (let i = 0; i < p; i++) store.run(d => { leaf(d).n = i + 1; });
        } else store.run(d => {
            for (let i = 0; i < p; i++) leaf(d)[mode === 'distinct' ? 'n' + i : 'n'] = i + 1;
        });
    };
    return {store, history, write, leaf};
}
