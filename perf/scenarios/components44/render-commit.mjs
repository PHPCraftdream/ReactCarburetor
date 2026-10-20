/* oxlint-disable carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load, require, setupDOM} from '../components43/fixture.mjs';
process.env.NODE_ENV = 'production';
const dom = setupDOM();
const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {Carburetor, AntiHookComponent} = await load('Carburetor');
const h = React.createElement;
class Store extends Carburetor { edit(fn) { this.update(fn); } }
const store = new Store({n: 1, unread: 0});
class Owner extends AntiHookComponent {
    pick = this.connectSelection(store, data => ({n: data.n}));
    render() { return h('p', null, this.pick().n + this.props.tick); }
}
class WarmStore extends Store {
    reads = 0; adds = 0; drops = 0;
    read(fn) { this.reads++; return super.read(fn); }
    subscribe(fn, options) { this.adds++; return super.subscribe(fn, options); }
    unsubscribe(id) { this.drops++; super.unsubscribe(id); }
}
const warm = new WarmStore({n: 1});
let last;
class WarmOwner extends AntiHookComponent {
    pick = this.connectSelection(warm, data => ({n: data.n}));
    render() {
        const next = this.pick();
        if (last) assert.equal(next, last);
        last = next;
        return h('p', null, next.n);
    }
}
const host = document.createElement('div'); document.body.append(host);
const root = createRoot(host);
const control = document.createElement('div'); document.body.append(control);
const controlRoot = createRoot(control);
const render = tick => flushSync(() => root.render(h(Owner, {tick})));
try {
    flushSync(() => controlRoot.render(h(WarmOwner, {tick: 0})));
    const before = [warm.reads, warm.adds, warm.drops];
    for (let tick = 1; tick <= 100; tick++) flushSync(() => controlRoot.render(h(WarmOwner, {tick})));
    assert.deepEqual([warm.reads, warm.adds, warm.drops], before);
    for (let tick = 0; tick < 100; tick++) render(tick);
    const iterations = 1000;
    const start = performance.now();
    for (let tick = 100; tick < 1100; tick++) render(tick);
    const renderCommitMs = performance.now() - start;
    assert.equal(host.textContent, '1100');
    let checksum = Number(host.textContent);
    flushSync(() => store.edit(data => { data.unread++; }));
    assert.equal(host.textContent, '1100');
    flushSync(() => store.edit(data => { data.n = 5; }));
    assert.equal(host.textContent, '1104'); checksum += Number(host.textContent);
    render(0); assert.equal(host.textContent, '5'); checksum += Number(host.textContent);
    assert.equal(checksum, 2209);
    emit({iterations, checksum, warmChurn: 0, renderCommitMs,
        nsPerRenderCommit: renderCommitMs * 1e6 / iterations});
} finally {
    flushSync(() => { root.unmount(); controlRoot.unmount(); });
    host.remove(); control.remove(); dom.window.close();
}
