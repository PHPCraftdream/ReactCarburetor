/* oxlint-disable carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dist, emit, load, require, setupDOM} from '../components43/fixture.mjs';

const count = Number(process.argv[2] ?? 1);
assert.ok([1, 4, 8].includes(count));
if (process.argv[3] !== 'child') {
    const child = spawnSync(process.execPath,
        ['--expose-gc', fileURLToPath(import.meta.url), String(count), 'child'],
        {env: {...process.env, DIST_ROOT: dist, NODE_ENV: 'production'}, encoding: 'utf8', timeout: 180000});
    process.stdout.write(child.stdout ?? '');
    process.stderr.write(child.stderr ?? '');
    assert.equal(child.status, 0);
} else {
    assert.equal(typeof globalThis.gc, 'function');
    const dom = setupDOM();
    const React = require('react');
    const {createRoot} = require('react-dom/client');
    const {flushSync} = require('react-dom');
    const {Carburetor, AntiHookComponent} = await load('Carburetor');
    const h = React.createElement;
    const payload = id => ({id, rows: [{n: 1}, {n: 2}]});
    class Store extends Carburetor {
        active = new Set(); reads = 0; adds = 0; drops = 0;
        edit(fn) { this.update(fn); }
        read(fn) { this.reads++; return super.read(fn); }
        subscribe(fn, options) {
            const id = super.subscribe(fn, options); this.active.add(id); this.adds++; return id;
        }
        unsubscribe(id) { this.active.delete(id); this.drops++; super.unsubscribe(id); }
    }
    function prepare(kind, stateful) {
        const stores = Array.from({length: count}, (_, n) => new Store({n: n + 1, unread: 0}));
        const refs = [];
        let owner, commits = 0;
        class Owner extends AntiHookComponent {
            state = {slot: -1, marker: null, tick: 0};
            selections = kind === 'selection' ? stores.map(store => this.connectSelection(store, data => data.n)) : [];
            views = kind === 'connect' ? stores.map(store => this.connect(store)) : [];
            componentDidMount() { super.componentDidMount(); commits++; }
            componentDidUpdate(prev) { super.componentDidUpdate(prev); commits++; }
            render() {
                const slot = (stateful ? this.state : this.props).slot;
                if (slot < 0) return h('p', null, 'off');
                const value = kind === 'selection' ? this.selections[slot]()
                    : kind === 'connect' ? this.views[slot].n : this.useCarburetor(stores[slot]).n;
                return h('p', null, value);
            }
        }
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        const render = (slot, marker, tick) => flushSync(() => {
            if (stateful && owner) owner.setState({slot, marker, tick});
            else root.render(h(Owner, {slot, marker, tick, ref: value => { owner = value; }}));
        });
        render(-1, null, -1);
        for (let slot = 0; slot < count; slot++) {
            const marker = payload(`${kind}/${stateful}/${slot}`);
            refs.push(new WeakRef(marker)); render(slot, marker, slot);
            assert.equal(host.textContent, String(slot + 1));
        }
        for (let tick = 10; tick < 16; tick++) render(-1, null, tick);
        assert.equal(host.textContent, 'off');
        assert.ok(stores.every(store => store.active.size === 0));
        const quiet = commits;
        flushSync(() => { for (const store of stores) store.edit(data => { data.n = 77; }); });
        assert.equal(commits, quiet); assert.equal(host.textContent, 'off');
        const current = payload('current');
        const currentRef = new WeakRef(current);
        render(-1, current, 16);
        return {stores, refs, root, host, render, currentRef, getCommits: () => commits,
            getCurrent: () => (stateful ? owner.state : owner.props).marker};
    }
    const empty = (() => new WeakRef(payload('empty')))();
    const held = payload('caller'); const strong = new WeakRef(held);
    const lanes = ['raw', 'connect', 'selection'].flatMap(kind => [false, true].map(state => prepare(kind, state)));
    const turn = () => new Promise(resolve => setImmediate(resolve));
    async function collect() {
        for (let i = 0; i < 16; i++) { await turn(); globalThis.gc(); }
        await turn();
    }
    let retained = 0;
    try {
        await collect();
        assert.equal(empty.deref(), undefined); assert.equal(strong.deref(), held);
        for (const lane of lanes) {
            const live = lane.refs.filter(ref => ref.deref() !== undefined).length;
            retained += live; assert.equal(live, 0);
            assert.equal(lane.currentRef.deref(), lane.getCurrent());
            for (let slot = 0; slot < count; slot++) {
                lane.render(slot, null, 20 + slot); assert.equal(lane.host.textContent, '77');
            }
            const store = lane.stores[count - 1];
            const warm = [store.reads, store.adds, store.drops];
            lane.render(count - 1, null, 30); lane.render(count - 1, null, 31);
            assert.deepEqual([store.reads, store.adds, store.drops], warm);
            const quiet = lane.getCommits();
            flushSync(() => store.edit(data => { data.unread++; }));
            assert.equal(lane.getCommits(), quiet);
            flushSync(() => store.edit(data => { data.n = 78; }));
            assert.equal(lane.host.textContent, '78'); assert.ok(lane.getCommits() > quiet);
            assert.equal(store.active.size, 1);
            for (let tick = 40; tick < 46; tick++) lane.render(-1, null, tick);
        }
        await collect();
        assert.ok(lanes.every(lane => lane.refs.every(ref => ref.deref() === undefined)));
    } finally {
        for (const lane of lanes) {
            flushSync(() => lane.root.unmount());
            assert.ok(lane.stores.every(store => store.active.size === 0)); lane.host.remove();
        }
        dom.window.close();
    }
    emit({retained, lanes: lanes.length, controls: 3, hiddenWritesSilent: true,
        rearmDelivered: true, warmChurn: 0, activeAfterTeardown: 0});
}
