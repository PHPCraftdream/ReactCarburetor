/* oxlint-disable carburetor/require-tsdoc, carburetor/max-line-length */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dist, emit, load, require, setupDOM} from './fixture.mjs';
const count = Number(process.argv[2] ?? 1);
assert.ok([1, 4, 8].includes(count));
if (process.argv[3] !== 'child') {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), String(count), 'child'],
        {env: {...process.env, DIST_ROOT: dist, NODE_ENV: 'production'}, encoding: 'utf8'});
    process.stdout.write(child.stdout ?? '');
    process.stderr.write(child.stderr ?? '');
    assert.equal(child.status, 0, 'isolated production lifetime child');
} else {
    assert.equal(process.env.NODE_ENV, 'production');
    assert.equal(typeof globalThis.gc, 'function');
    const dom = setupDOM();
    const React = require('react');
    const {createRoot} = require('react-dom/client');
    const {flushSync} = require('react-dom');
    const {Carburetor, AntiHookComponent} = await load('Carburetor');
    const {useCarburetorValue} = await load('Interop');
    const h = React.createElement;
    const pick = data => data.n;
    const payload = id => ({id, rows: Array.from({length: 8}, (_, n) => ({n}))});
    class Store extends Carburetor {
        active = new Set(); adds = 0; removes = 0; reads = 0;
        edit(fn) { this.update(fn); }
        read(record) { this.reads++; return super.read(record); }
        subscribe(fn, options) {
            const id = super.subscribe(fn, options); this.active.add(id); this.adds++; return id;
        }
        unsubscribe(id) { this.active.delete(id); this.removes++; super.unsubscribe(id); }
    }
    function prepare(kind, mode) {
        const stores = Array.from({length: count}, (_, n) => new Store({n, unread: 0}));
        const current = mode === 'same' ? stores[0] : new Store({n: 100, unread: 0});
        const refs = [];
        let commits = 0, lastView, escaped;
        const container = document.createElement('div'); document.body.append(container);
        const root = createRoot(container);
        class Raw extends AntiHookComponent {
            componentDidMount() { super.componentDidMount(); commits++; }
            componentDidUpdate(prev) { super.componentDidUpdate(prev); commits++; }
            render() {
                if (!this.props.show) return h('p', null, 'off');
                const view = this.useCarburetor(this.props.source);
                if (this.props.warm) assert.equal(view, lastView, 'unchanged-data root identity');
                lastView = view;
                escaped = view;
                return h('p', null, view.n);
            }
        }
        class Connected extends AntiHookComponent {
            view = this.connect(() => this.props.source);
            componentDidMount() { super.componentDidMount(); commits++; }
            componentDidUpdate(prev) { super.componentDidUpdate(prev); commits++; }
            render() { return h('p', null, this.props.show ? this.view.n : 'off'); }
        }
        function Value({source}) {
            const value = useCarburetorValue(source, pick);
            React.useLayoutEffect(() => { commits++; });
            return h('p', null, value);
        }
        function Hook({show, source}) { return show ? h(Value, {source}) : h('p', null, 'off'); }
        const Component = kind === 'raw' ? Raw : kind === 'connect' ? Connected : Hook;
        const render = (source, marker, tick, show = true, warm = false) =>
            flushSync(() => root.render(h(Component, {source, marker, tick, show, warm})));
        function visit(source, tick) {
            const marker = payload(tick); refs.push(new WeakRef(marker)); render(source, marker, tick);
            assert.equal(container.textContent, String(source.getData().n));
        }
        if (mode === 'same') visit(current, 0);
        else for (let i = 0; i < count; i++) visit(stores[i], i);
        const show = mode !== 'off';
        for (let tick = 10; tick < 16; tick++) render(current, null, tick, show);
        const baseline = [current.reads, current.adds, current.removes];
        render(current, null, 16, show, show); render(current, null, 17, show, show);
        assert.deepEqual([current.reads, current.adds, current.removes], baseline, 'zero warm read/registration churn');
        const text = show ? String(current.getData().n) : 'off';
        const quiet = commits;
        const initialData = current.getData();
        if (mode !== 'same') {
            flushSync(() => {
                for (const store of stores) if (store !== current) store.edit(data => { data.n = 77; });
                current.edit(data => { data.unread++; });
            });
            assert.equal(container.textContent, text); assert.equal(commits, quiet, 'retired/unread silence');
            if (mode === 'swap') {
                if (escaped) void escaped.unread;
                flushSync(() => current.edit(data => { data.unread++; }));
                assert.equal(commits, quiet, 'escaped read outside render is inert');
            }
            flushSync(() => current.edit(data => { data.n = 101; }));
            assert.equal(container.textContent, show ? '101' : 'off');
            if (show) assert.ok(commits > quiet, 'observed write commits');
            else assert.equal(commits, quiet, 'branch-off write silent');
        }
        const afterGC = () => {
            assert.equal(current.getData(), initialData, 'same-source original data survives through GC');
            assert.equal(container.textContent, text);
            const before = commits;
            flushSync(() => current.edit(data => { data.unread++; }));
            assert.equal(commits, before, 'same-source unread write silent after GC');
            assert.equal(container.textContent, text);
            flushSync(() => current.edit(data => { data.n = 101; }));
            assert.equal(container.textContent, '101');
            assert.ok(commits > before, 'same-source observed write delivers after GC');
        };
        assert.ok(stores.every(store => store === current && show ? store.active.size === 1 : store.active.size === 0));
        assert.equal(current.active.size, Number(show));
        return {kind, mode, refs, stores, current, root, container, render, afterGC};
    }
    async function prepareAbandoned(self) {
        const current = new Store({n: 100, unread: 0});
        const retired = new Store({n: 1, unread: 0});
        const pending = Promise.withResolvers();
        let released = false, suspended = false;
        const container = document.createElement('div'); document.body.append(container);
        const root = createRoot(container);
        function Gate() {
            if (!released) { suspended = true; throw pending.promise; }
            return null;
        }
        class Owner extends AntiHookComponent {
            render() {
                const value = this.useCarburetor(this.props.source).n;
                if (this.props.block && self && !released) { suspended = true; throw pending.promise; }
                return h(React.Fragment, null, h('p', null, value),
                    this.props.block && !self ? h(Gate) : null);
            }
        }
        const tree = (source, marker, tick, block = false) => h(React.Suspense, {fallback: 'waiting'},
            h(Owner, {source, marker, tick, block}));
        const render = (source, marker, tick) => flushSync(() => root.render(tree(source, marker, tick)));
        render(current, null, 0);
        function start() {
            const marker = payload(self ? 'abandoned-self' : 'abandoned-child');
            const ref = new WeakRef(marker);
            React.startTransition(() => root.render(tree(retired, marker, 1, true)));
            return ref;
        }
        const ref = start();
        for (let i = 0; i < 32 && !suspended; i++) await new Promise(resolve => setImmediate(resolve));
        assert.equal(suspended, true, 'public render actually suspended');
        assert.equal(container.textContent, '100', 'suspended work preserves committed DOM');
        assert.equal(retired.active.size, 0, 'tentative source never subscribes');
        render(current, null, 2);
        released = true; pending.resolve();
        for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
        for (let tick = 3; tick < 9; tick++) render(current, null, tick);
        flushSync(() => retired.edit(data => { data.n = 77; }));
        assert.equal(container.textContent, '100', 'cancelled source stays silent');
        flushSync(() => current.edit(data => { data.n = 101; }));
        assert.equal(container.textContent, '101', 'committed source still delivers');
        assert.equal(current.active.size, 1); assert.equal(retired.active.size, 0);
        return {kind: 'raw', mode: self ? 'abandoned-self' : 'abandoned-child',
            refs: [ref], stores: [retired], current, root, container, render};
    }
    function emptyControl() { return new WeakRef(payload('empty')); }
    const empty = emptyControl();
    const held = payload('caller'); const strong = new WeakRef(held);
    const lanes = ['raw', 'connect', 'hook'].flatMap(kind => ['swap', 'same', 'off'].map(mode => prepare(kind, mode)));
    lanes.push(await prepareAbandoned(true), await prepareAbandoned(false));
    for (const lane of lanes) lane.render(lane.current, held, 18, lane.mode !== 'off');
    const turn = () => new Promise(resolve => setImmediate(resolve));
    try {
        for (let i = 0; i < 16; i++) { await turn(); globalThis.gc(); }
        await turn();
        assert.equal(empty.deref(), undefined, 'empty control collects');
        assert.equal(strong.deref(), held, 'caller-live control survives');
        let retained = 0;
        for (const lane of lanes) {
            const live = lane.refs.filter(ref => ref.deref() !== undefined).length;
            retained += live;
            assert.equal(live, 0, `${lane.kind}/${lane.mode}: obsolete props collect with live sources/owner`);
            if (lane.mode === 'same') lane.afterGC();
            if (lane.mode === 'off') {
                lane.render(lane.stores[0], null, 30);
                assert.equal(lane.container.textContent, '77', 'retired source re-arms');
            }
        }
        emit({retained, controls: 2, lanes: lanes.length, warmChurn: 0});
    } finally {
        for (const lane of lanes) {
            flushSync(() => lane.root.unmount());
            assert.equal(lane.current.active.size, 0);
            assert.ok(lane.stores.every(store => store.active.size === 0));
            lane.container.remove();
        }
        dom.window.close();
    }
}
