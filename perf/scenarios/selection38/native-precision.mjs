/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {emit, load, setupReact} from '../../harness/lib.mjs';
const {Carburetor, AntiHookComponent} = await load();
const {React, flushSync, root, container} = await setupReact();
class Store extends Carburetor { change(fn) { this.update(fn); } }
const size = 1000;
const rows = Array.from({length: size}, (_, id) => ({id, n: 1}));
const store = new Store({rows, map: new Map(rows.map(row => [row.id, row]))});
let sizeRenders = 0; let lookupRenders = 0;
class SizeView extends AntiHookComponent {
    data = this.connect(store);
    render() { sizeRenders++; return React.createElement('output', {id: 'size'}, this.data.map.size); }
}
class LookupView extends AntiHookComponent {
    data = this.connect(store);
    render() { lookupRenders++; return React.createElement('output', {id: 'lookup'}, this.data.map.get(0).n); }
}
const seen = [];
const stop = store.watch(data => data.map, (next, previous) => seen.push({next, previous}));
let metrics;
try {
    flushSync(() => root.render(React.createElement('section', null, React.createElement(SizeView), React.createElement(LookupView))));
    sizeRenders = 0; lookupRenders = 0;
    flushSync(() => store.change(data => { data.rows[size - 1].n = 2; }));
    const unrelatedSizeRenders = sizeRenders; const unrelatedLookupRenders = lookupRenders;
    const unrelatedValues = container.querySelector('#size').textContent === String(size)
        && container.querySelector('#lookup').textContent === '1'
        && seen.length === 1 && seen[0].next.get(size - 1).n === 2 && seen[0].previous.get(size - 1).n === 1;
    sizeRenders = 0; lookupRenders = 0;
    flushSync(() => store.change(data => { data.rows[0].n = 2; }));
    const ownSizeRenders = sizeRenders; const ownLookupRenders = lookupRenders;
    const ownValues = seen.length === 2 && seen[1].next.get(0).n === 2 && seen[1].previous === seen[0].next
        && seen[0].next.get(0).n === 1 && container.querySelector('#lookup').textContent === '2';
    sizeRenders = 0; lookupRenders = 0;
    flushSync(() => store.change(data => { data.map.set(size, {id: size, n: 3}); }));
    const nativeValues = seen.length === 3 && seen[2].next.size === size + 1 && seen[2].next.get(size).n === 3
        && seen[2].previous === seen[1].next && !seen[1].next.has(size)
        && container.querySelector('#size').textContent === String(size + 1)
        && container.querySelector('#lookup').textContent === '2';
    metrics = {unrelatedSizeRenders, unrelatedLookupRenders, ownSizeRenders, ownLookupRenders,
        nativeSizeRenders: sizeRenders, nativeLookupRenders: lookupRenders,
        graphDeliveries: seen.length, valuesCorrect: unrelatedValues && ownValues && nativeValues};
} finally { stop(); root.unmount(); }
emit({...metrics, done: true});
