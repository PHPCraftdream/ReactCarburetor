/* oxlint-disable carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {emit, load, require, setupDOM} from './fixture.mjs';
process.env.NODE_ENV = 'production';
const dom = setupDOM();
const React = require('react');
const {createRoot} = require('react-dom/client');
const {flushSync} = require('react-dom');
const {Carburetor, AntiHookComponent} = await load('Carburetor');
const iterations = 1000;
class Store extends Carburetor {
    edit(fn) { this.update(fn); }
}
const store = new Store({n: 1, unread: 0});
class Owner extends AntiHookComponent {
    render() {
        return React.createElement('p', null, this.useCarburetor(store).n + this.props.tick);
    }
}
const container = document.createElement('div'); document.body.append(container);
const root = createRoot(container);
const render = tick => flushSync(() => root.render(React.createElement(Owner, {tick})));
try {
    // Untimed independent warm control; the measured owner has no counters, wrappers or refs.
    class WarmStore extends Store {
        reads = 0; adds = 0; removes = 0;
        read(record) { this.reads++; return super.read(record); }
        subscribe(fn, options) { this.adds++; return super.subscribe(fn, options); }
        unsubscribe(id) { this.removes++; return super.unsubscribe(id); }
    }
    const warm = new WarmStore({n: 1});
    class WarmOwner extends AntiHookComponent {
        render() { return React.createElement('p', null, this.useCarburetor(warm).n); }
    }
    const warmContainer = document.createElement('div'); document.body.append(warmContainer);
    const warmRoot = createRoot(warmContainer);
    flushSync(() => warmRoot.render(React.createElement(WarmOwner, {tick: 0})));
    const before = [warm.reads, warm.adds, warm.removes];
    for (let tick = 1; tick <= 100; tick++) {
        flushSync(() => warmRoot.render(React.createElement(WarmOwner, {tick})));
    }
    assert.deepEqual([warm.reads, warm.adds, warm.removes], before);
    flushSync(() => warmRoot.unmount()); warmContainer.remove();
    for (let tick = 0; tick < 100; tick++) render(tick);
    let checksum = 0;
    const start = performance.now();
    for (let tick = 100; tick < 100 + iterations; tick++) render(tick);
    const renderCommitMs = performance.now() - start;
    assert.equal(container.textContent, '1100');
    checksum += Number(container.textContent);
    flushSync(() => store.edit(data => { data.unread++; }));
    assert.equal(container.textContent, '1100');
    flushSync(() => store.edit(data => { data.n = 5; }));
    assert.equal(container.textContent, '1104', 'observed write must deliver through the mounted owner');
    checksum += Number(container.textContent);
    render(0); assert.equal(container.textContent, '5'); checksum += Number(container.textContent);
    assert.equal(checksum, 2209);
    emit({renderCommitMs, iterations, checksum, delivered: 1, warmChurn: 0,
        nsPerRenderCommit: renderCommitMs * 1e6 / iterations});
} finally { flushSync(() => root.unmount()); container.remove(); dom.window.close(); }
