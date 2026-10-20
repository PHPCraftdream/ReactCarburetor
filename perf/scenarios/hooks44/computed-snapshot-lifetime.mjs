/* oxlint-disable carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dist, emit, load, require, setupDOM} from '../components43/fixture.mjs';
if (process.argv[2] !== 'child') {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), 'child'],
        {env: {...process.env, DIST_ROOT: dist, NODE_ENV: 'production'}, encoding: 'utf8', timeout: 180000});
    process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '');
    assert.equal(child.status, 0);
} else {
    assert.equal(typeof globalThis.gc, 'function');
    const React = require('react');
    const {renderToString} = require('react-dom/server');
    const {Carburetor, computed} = await load('Carburetor');
    const {useComputedValue} = await load('Interop');
    const h = React.createElement;
    const marker = id => ({id, rows: [{n: 1}, {n: 2}]});
    class Store extends Carburetor { edit(fn) { this.update(fn); } }
    class External {
        version = 0; callbacks = new Map(); next = 0;
        constructor(value) { this.value = value; }
        getUID() { return 'external44'; }
        getVersion() { return this.version; }
        get() { return this.value; }
        subscribe(fn) { const id = String(++this.next); this.callbacks.set(id, fn); return id; }
        unsubscribe(id) { this.callbacks.delete(id); }
    }
    function makeSource(kind) {
        if (kind === 'external') {
            const source = new External({n: 1, marker: marker(kind)});
            return {source, advance() { source.value = {n: 2, marker: marker('new')}; source.version++; }};
        }
        const store = new Store({n: 1});
        const source = computed(read => ({n: read(store).n, marker: marker('native')}));
        return {source, store, advance() { store.edit(data => { data.n = 2; }); }};
    }
    function View({source}) { return h('p', null, useComputedValue(source).n); }
    function ssr(kind, viaHook) {
        const lane = makeSource(kind);
        const first = lane.source.get(); const ref = new WeakRef(first.marker);
        const html = viaHook ? renderToString(h(View, {source: lane.source})) : `<p>${first.n}</p>`;
        assert.equal(html, '<p>1</p>');
        lane.advance(); assert.equal(lane.source.get().n, 2);
        if (kind === 'external') assert.equal(lane.source.callbacks.size, 0);
        return {...lane, ref, viaHook};
    }
    const server = ['external', 'native'].flatMap(kind => [false, true].map(viaHook => ssr(kind, viaHook)));
    const dom = setupDOM();
    const {createRoot} = require('react-dom/client');
    const {flushSync} = require('react-dom');
    function client(kind, swap) {
        const lane = makeSource(kind), replacement = makeSource(kind);
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        const ref = new WeakRef(lane.source.get().marker);
        flushSync(() => root.render(h(View, {source: lane.source})));
        assert.equal(host.textContent, '1');
        const oldCallbacks = kind === 'external' ? [...lane.source.callbacks.values()] : [];
        if (swap) {
            replacement.advance();
            for (let tick = 0; tick < 6; tick++) {
                flushSync(() => root.render(h(View, {source: replacement.source, tick})));
            }
            assert.equal(host.textContent, '2');
        } else {
            for (let tick = 0; tick < 6; tick++) {
                flushSync(() => root.render(h('p', {'data-turnover': tick})));
                assert.equal(host.firstElementChild?.getAttribute('data-turnover'), String(tick),
                    'non-hook client turnover committed on the retained root');
            }
            assert.equal(host.textContent, '');
        }
        lane.advance(); assert.equal(lane.source.get().n, 2);
        if (kind === 'external') assert.equal(lane.source.callbacks.size, 0);
        for (const callback of oldCallbacks) flushSync(callback);
        assert.equal(host.textContent, swap ? '2' : '');
        return {...lane, replacement, root, host, ref, swap};
    }
    const clients = ['external', 'native'].flatMap(kind => [false, true].map(swap => client(kind, swap)));
    const currentRefs = [...server, ...clients].map(lane => new WeakRef(lane.source.get().marker));
    const empty = (() => new WeakRef(marker('empty')))();
    const held = makeSource('external');
    const old = held.source.get(); const strong = new WeakRef(old.marker);
    renderToString(h(View, {source: held.source})); held.advance();
    const turn = () => new Promise(resolve => setImmediate(resolve));
    let retained = 0;
    try {
        for (let i = 0; i < 16; i++) { await turn(); globalThis.gc(); }
        await turn();
        assert.equal(empty.deref(), undefined); assert.equal(strong.deref(), old.marker);
        for (const [index, lane] of [...server, ...clients].entries()) {
            retained += Number(lane.ref.deref() !== undefined);
            assert.equal(lane.ref.deref(), undefined);
            assert.equal(lane.source.get().n, 2);
            assert.equal(currentRefs[index].deref(), lane.source.get().marker);
        }
        for (const lane of server) if (lane.viaHook) {
            assert.equal(renderToString(h(View, {source: lane.source})), '<p>2</p>');
        }
    } finally {
        for (const lane of clients) {
            flushSync(() => lane.root.unmount());
            if (lane.replacement.source.callbacks) assert.equal(lane.replacement.source.callbacks.size, 0);
            lane.host.remove();
        }
        dom.window.close();
    }
    emit({retained, ssrLanes: server.length, clientLanes: clients.length,
        controls: 3, activeAfterTeardown: 0});
}
