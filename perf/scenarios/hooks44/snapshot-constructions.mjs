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
    publish() { this.value.n++; this.version++; for (const fn of this.callbacks.values()) fn(); }
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
const input = makeSource();
const source = input.source ?? input;
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const render = tick => flushSync(() => root.render(h(React.Fragment, null,
    ...Array.from({length: consumers}, (_, key) => h(View, {key, source, tick})))));
const NativeWeakRef = globalThis.WeakRef;
let weakRefConstructions = 0;
try {
    globalThis.WeakRef = class extends NativeWeakRef {
        constructor(value) { super(value); weakRefConstructions++; }
    };
    const target = {};
    assert.equal(new WeakRef(target).deref(), target);
    const controlConstructions = weakRefConstructions;
    assert.equal(controlConstructions, 1);
    weakRefConstructions = 0;
    render(0);
    const initialConstructions = weakRefConstructions;
    for (let tick = 1; tick <= 100; tick++) render(tick);
    const warmConstructions = weakRefConstructions - initialConstructions;
    for (let i = 0; i < 20; i++) flushSync(() => input.publish());
    const publicationConstructions = weakRefConstructions - initialConstructions - warmConstructions;
    assert.equal(host.textContent, '20'.repeat(consumers));
    assert.equal(initialConstructions, 1);
    assert.equal(warmConstructions, 0);
    assert.equal(publicationConstructions, 20);
    emit({consumers, publications: 20, initialConstructions, warmConstructions,
        publicationConstructions, weakRefConstructions, controlConstructions,
        sharedEnvelopesPerPublication: publicationConstructions / 20});
} finally {
    globalThis.WeakRef = NativeWeakRef;
    flushSync(() => root.unmount());
    if (source.callbacks) assert.equal(source.callbacks.size, 0);
    host.remove(); dom.window.close();
}
