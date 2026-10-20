/* oxlint-disable carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load, require, setupDOM} from '../components43/fixture.mjs';
process.env.NODE_ENV = 'production';
const dom = setupDOM();
const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {useComputedValue} = await load('Interop');
const {Carburetor, computed} = await load('Carburetor');
const h = React.createElement;
const consumers = Number(process.argv[2] ?? 1);
assert.ok([1, 4, 8].includes(consumers));
const kind = process.argv[3] ?? 'external';
assert.ok(['native', 'external'].includes(kind));
class External {
    value = {n: 0}; version = 0; callbacks = new Map(); next = 0;
    getUID() { return 'external44'; }
    getVersion() { return this.version; }
    get() { return this.value; }
    subscribe(fn) { const id = String(++this.next); this.callbacks.set(id, fn); return id; }
    unsubscribe(id) { this.callbacks.delete(id); }
    deliver() { for (const fn of this.callbacks.values()) fn(); }
    publish() { this.value.n++; this.version++; this.deliver(); }
}
function makeSource() {
    if (kind === 'external') return new External();
    class Store extends Carburetor {
        increment() { this.update(data => { data.index.set('n', data.index.get('n') + 1); }); }
    }
    const store = new Store({index: new Map([['n', 0]])});
    const source = computed(read => read(store).index);
    return {source, publish() { store.increment(); }};
}
function View({source}) {
    const value = useComputedValue(source);
    return h('p', null, value instanceof Map ? value.get('n') : value.n);
}
function make(input) {
    const source = input.source ?? input;
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    const render = tick => flushSync(() => root.render(h(React.Fragment, null,
        ...Array.from({length: consumers}, (_, key) => h(View, {key, source, tick})))));
    render(0);
    if (source.callbacks) assert.equal(source.callbacks.size, consumers);
    return {host, root, source, check: () => render(1), publish: () => input.publish()};
}
const lanes = [];
try {
    const timed = make(makeSource()); lanes.push(timed);
    for (let i = 0; i < 100; i++) flushSync(() => timed.check());
    const startChecks = performance.now();
    for (let i = 0; i < 1000; i++) flushSync(() => timed.check());
    const checksMs = performance.now() - startChecks;
    const startPublications = performance.now();
    for (let i = 0; i < 20; i++) flushSync(() => timed.publish());
    const publicationsMs = performance.now() - startPublications;
    assert.equal(timed.host.textContent, '20'.repeat(consumers));
    emit({consumers, publications: 20, checks: 1000, checksMs, publicationsMs});
} finally {
    for (const lane of lanes) {
        flushSync(() => lane.root.unmount());
        if (lane.source.callbacks) assert.equal(lane.source.callbacks.size, 0);
        lane.host.remove();
    }
    dom.window.close();
}
