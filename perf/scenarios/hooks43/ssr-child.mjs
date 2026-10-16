/* oxlint-disable react/globals, carburetor-internal/require-tsdoc, carburetor-internal/max-line-length */
import assert from 'node:assert/strict';
import {cpSync, existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {dist, emit, require as repoRequire, load} from '../components43/fixture.mjs';
process.env.NODE_ENV = 'development';
assert.equal(typeof globalThis.window, 'undefined');
const version = process.argv[2] ?? '18';
const gap = process.argv[3] === 'gap';
const consumerRoot = resolve(realpathSync(resolve('node_modules')), '..', `.consumer-matrix/react${version}-npm`);
const reactRoot = repoRequire('react').version.startsWith(version + '.') ? resolve('.') : consumerRoot;
const require = createRequire(resolve(reactRoot, 'package.json'));
const React = require('react');
assert.ok(React.version.startsWith(version + '.'), 'selected consumer React version');
const {renderToString} = require('react-dom/server');
const h = React.createElement;
const temporary = mkdtempSync(resolve(tmpdir(), 'carburetor-hooks43-'));
const link = resolve(temporary, 'node_modules');
let linked = false, dom, root;
const act = React.act ?? require('react-dom/test-utils').act;
function countedStore(Base) {
    return class extends Base {
        active = new Set(); adds = 0;
        edit(fn) { this.update(fn); }
        subscribe(fn, options) {
            const id = super.subscribe(fn, options);
            this.adds++; this.active.add(id); return id;
        }
        unsubscribe(id) { this.active.delete(id); super.unsubscribe(id); }
    };
}
function capture(Component) {
    const errors = []; const original = console.error;
    console.error = (...args) => { errors.push(args.map(String).join(' ')); original(...args); };
    try { return {html: renderToString(h(Component)), errors}; }
    finally { console.error = original; }
}
function copy(name) {
    const directory = resolve(temporary, name);
    cpSync(dist, directory, {recursive: true});
    writeFileSync(resolve(directory, 'package.json'), JSON.stringify({
        type: existsSync(resolve(directory, 'Carburetor/index.mjs')) ? 'module' : 'commonjs',
    }));
    return directory;
}
try {
    symlinkSync(realpathSync(resolve(reactRoot, 'node_modules')), link, 'junction'); linked = true;
    const serverDir = copy('server');
    const api = await load('Carburetor', serverDir, require);
    const interop = await load('Interop', serverDir, require);
    const Store = countedStore(api.Carburetor);
    const server = new Store({n: 7, nested: {n: 7}, unread: 0});
    const derived = api.computed(read => read(server).n);
    const cache = new api.ResourceCache(async () => ({n: 7}), {ttl: Infinity});
    await cache.load('x');
    let cacheAdds = 0;
    const subscribe = cache.subscribe;
    cache.subscribe = (...args) => { cacheAdds++; return subscribe.apply(cache, args); };
    const pick = data => data.n;
    class ClassControl extends api.AntiHookComponent {
        render() { return h('p', null, this.useCarburetor(server).n); }
    }
    function StoreHook() { return h('p', null, interop.useCarburetorValue(server, pick)); }
    const graphServer = new Store({nested: {leaf: {n: 7}}, unread: 0});
    const pickGraph = data => data.nested;
    function StoreGraph() { return h('p', null, interop.useCarburetorValue(graphServer, pickGraph).leaf.n); }
    function ComputedControl() { return h('p', null, interop.useComputedValue(derived)); }
    function ResourceControl() { return h('p', null, interop.useResourceValue(cache, ['x'], view => view.data.n)); }
    function Empty() { return h('p', null, 7); }
    function LayoutPositive() { React.useLayoutEffect(() => {}); return h('p', null, 7); }
    const results = Object.fromEntries(Object.entries({empty: Empty, class: ClassControl,
        computed: ComputedControl, resource: ResourceControl, store: StoreHook, graph: StoreGraph,
        layoutPositive: LayoutPositive}).map(([name, Component]) => [name, capture(Component)]));
    const warnings = Object.fromEntries(Object.entries(results).map(([name, result]) => [name,
        result.errors.filter(text => text.includes('useLayoutEffect does nothing on the server')).length]));
    for (const result of Object.values(results)) assert.equal(result.html, '<p>7</p>');
    for (const name of ['empty', 'class', 'computed', 'resource', 'store', 'graph']) {
        assert.deepEqual(results[name].errors, [], `${name}: clean SSR diagnostics`);
    }
    assert.equal(warnings.store, 0, 'both store commit effects must be server-safe');
    if (version === '18') assert.ok(warnings.layoutPositive > 0, 'React18 diagnostic positive control');
    else assert.equal(warnings.layoutPositive, 0, 'React19 dispatcher control');
    assert.equal(server.adds, 0); assert.equal(graphServer.adds, 0); assert.equal(cacheAdds, 0);
    for (const source of [server, graphServer]) {
        const baseline = source.getVersion();
        source.edit(data => { data.unread++; });
        const targets = source[Symbol.for('react-carburetor/v1/store-targets-since')](baseline);
        assert.ok(targets === undefined || targets.size === 0, 'SSR owns no target proofs');
    }
    const {JSDOM} = repoRequire('jsdom');
    dom = new JSDOM('<!doctype html><body><div id="root">' + results.store.html + '</div></body>',
        {url: 'http://localhost/'});
    for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const clientDir = copy('client');
    const clientApi = await load('Carburetor', clientDir, require);
    const clientInterop = await load('Interop', clientDir, require);
    const ClientStore = countedStore(clientApi.Carburetor);
    const first = new ClientStore({n: 7, unread: 0});
    const second = new ClientStore({n: 9, unread: 0});
    let commits = 0;
    function Writer({source}) {
        React.useLayoutEffect(() => { source.edit(data => { data.n = 8; }); }, [source]);
        return null;
    }
    function Client({source, write = false}) {
        const value = clientInterop.useCarburetorValue(source, pick);
        React.useLayoutEffect(() => { commits++; });
        return h(React.Fragment, null, h('p', null, value), write ? h(Writer, {source}) : null);
    }
    const container = document.getElementById('root');
    const errors = [];
    const {hydrateRoot, createRoot} = require('react-dom/client');
    await act(async () => { root = hydrateRoot(container, h(Client, {source: first, write: gap}),
        {onRecoverableError: error => errors.push(error)}); });
    assert.equal(container.textContent, gap ? '8' : '7'); assert.equal(first.active.size, 1);
    const quiet = commits;
    await act(async () => first.edit(data => { data.unread++; }));
    assert.equal(commits, quiet);
    await act(async () => first.edit(data => { data.n = 11; }));
    assert.equal(container.textContent, '11'); assert.ok(commits > quiet);
    await act(async () => root.render(h(Client, {source: second})));
    assert.equal(container.textContent, '9'); assert.equal(first.active.size, 0); assert.equal(second.active.size, 1);
    const swapped = commits;
    await act(async () => first.edit(data => { data.n = 50; }));
    assert.equal(commits, swapped); assert.equal(container.textContent, '9');
    await act(async () => second.edit(data => { data.n = 10; }));
    assert.equal(container.textContent, '10'); assert.deepEqual(errors, []);
    await act(async () => root.unmount()); root = undefined;
    assert.equal(first.active.size + second.active.size, 0);
    const equal = new ClientStore({left: 1, right: 1, useLeft: true, unread: 0});
    const select = data => data.useLeft ? data.left : data.right;
    let equalCommits = 0;
    function Equal() {
        const value = clientInterop.useCarburetorValue(equal, select);
        React.useLayoutEffect(() => { equalCommits++; });
        return h('p', null, value);
    }
    root = createRoot(container);
    await act(async () => root.render(h(Equal)));
    const before = equalCommits;
    await act(async () => equal.edit(data => { data.useLeft = false; }));
    await act(async () => equal.edit(data => { data.left = 9; data.unread++; }));
    assert.equal(equalCommits, before, 'equal migration installs new reads without a React commit');
    await act(async () => equal.edit(data => { data.right = 3; }));
    assert.equal(container.textContent, '3'); assert.ok(equalCommits > before);
    await act(async () => root.unmount()); root = undefined; assert.equal(equal.active.size, 0);
    const graphFirst = new ClientStore({nested: {leaf: {n: 7}}, unread: 0});
    const graphSecond = new ClientStore({nested: {leaf: {n: 9}}, unread: 0});
    let graphCommits = 0, layoutAcquires = 0;
    const track = Symbol.for('react-carburetor/v1/store-track-targets');
    const since = Symbol.for('react-carburetor/v1/store-targets-since');
    let proofChecks = 0;
    function proof(source, owned, label) {
        const raw = source.getData();
        const versionBefore = source.getVersion();
        source.edit(data => { data.unread++; });
        const targets = source[since](versionBefore);
        const recorded = targets !== undefined && Array.from(targets.values()).some(set => set.has(raw));
        assert.equal(recorded, owned, label);
        proofChecks++;
    }
    // No forwarding or private-owner counters: inspect proofs generated by real writes.
    const cheap = new ClientStore({n: 7, unread: 0});
    proof(cheap, false, 'independent no-ledger control');
    const releasePositive = cheap[track]();
    proof(cheap, true, 'real target-owner positive control');
    releasePositive();
    proof(cheap, false, 'positive owner release');
    let passiveProofRejected = 0;
    function PassiveOwnerControl() {
        React.useEffect(() => cheap[track](), []);
        React.useLayoutEffect(() => {
            proof(cheap, false, 'passive owner is absent at layout');
            passiveProofRejected++;
        }, []);
        return null;
    }
    root = createRoot(container);
    await act(async () => root.render(h(PassiveOwnerControl)));
    proof(cheap, true, 'passive positive after effects');
    await act(async () => root.unmount()); root = undefined;
    proof(cheap, false, 'passive control release');
    function GraphWriter({source}) {
        React.useLayoutEffect(() => { source.edit(data => { data.nested.leaf.n = 8; }); }, [source]);
        return null;
    }
    function GraphClient({source, write = false}) {
        const value = clientInterop.useCarburetorValue(source, pickGraph);
        React.useLayoutEffect(() => { graphCommits++; });
        React.useLayoutEffect(() => {
            proof(source, true, 'graph acquisition before passive effects');
            layoutAcquires++;
        }, [source]);
        return h(React.Fragment, null, h('p', null, value.leaf.n), write ? h(GraphWriter, {source}) : null);
    }
    container.innerHTML = results.graph.html;
    await act(async () => { root = hydrateRoot(container, h(GraphClient, {source: graphFirst, write: gap}),
        {onRecoverableError: error => errors.push(error)}); });
    assert.equal(container.textContent, gap ? '8' : '7', 'graph child-layout write reaches selected DOM');
    assert.equal(graphFirst.active.size, 1);
    proof(graphFirst, true, 'mounted graph owns real proofs');
    const graphQuiet = graphCommits;
    await act(async () => graphFirst.edit(data => { data.unread++; }));
    assert.equal(graphCommits, graphQuiet, 'graph unread write is silent');
    await act(async () => graphFirst.edit(data => { data.nested.leaf.n = 11; }));
    assert.equal(container.textContent, '11'); assert.ok(graphCommits > graphQuiet);
    await act(async () => root.render(h(GraphClient, {source: graphSecond})));
    assert.equal(container.textContent, '9');
    assert.equal(graphFirst.active.size, 0); assert.equal(graphSecond.active.size, 1);
    proof(graphFirst, false, 'swap releases old target proofs');
    proof(graphSecond, true, 'swap acquires new target proofs');
    const graphSwapped = graphCommits;
    await act(async () => graphFirst.edit(data => { data.nested.leaf.n = 50; }));
    assert.equal(container.textContent, '9'); assert.equal(graphCommits, graphSwapped);
    await act(async () => graphSecond.edit(data => { data.nested.leaf.n = 10; }));
    assert.equal(container.textContent, '10'); assert.ok(graphCommits > graphSwapped);
    assert.deepEqual(errors, [], 'scalar and graph hydration without recovery');
    await act(async () => root.unmount()); root = undefined;
    assert.equal(graphFirst.active.size + graphSecond.active.size, 0, 'graph ownership releases');
    proof(graphSecond, false, 'unmount releases graph target proofs');
    // Stable source and ledger verdict: the dependency-bound first effect cannot refile this
    // selector-only commit. A real right-path delivery in owner layout witnesses the second.
    const boundary = new ClientStore({left: 1, right: 1, unread: 0});
    const left = data => data.left;
    const right = data => data.right;
    let layoutReconciliations = 0, comparisons = 0;
    const compare = (a, b) => { comparisons++; return a === b; };
    function Boundary({moved}) {
        const value = clientInterop.useCarburetorValue(boundary, moved ? right : left, compare);
        React.useLayoutEffect(() => {
            if (!moved) return;
            const beforeComparison = comparisons;
            boundary.edit(data => { data.right = 2; });
            assert.ok(comparisons > beforeComparison,
                'real consumer comparator runs for the right-path write in layout, before passive effects');
            layoutReconciliations++;
        }, [moved]);
        return h('p', null, value);
    }
    root = createRoot(container);
    await act(async () => root.render(h(Boundary, {moved: false})));
    proof(boundary, false, 'mounted scalar remains no-ledger');
    await act(async () => root.render(h(Boundary, {moved: true})));
    assert.equal(container.textContent, '2');
    await act(async () => root.unmount()); root = undefined;
    emit({storeWarnings: warnings.store, graphWarnings: warnings.graph, proofChecks,
        layoutAcquires, layoutReconciliations, passiveProofRejected,
        positiveWarnings: warnings.layoutPositive,
        serverAdds: server.adds + graphServer.adds + cacheAdds, hydrationRecovery: errors.length, releasedOwners: equal.active.size,
        equalMigration: 1, gap: Number(gap)});
} finally {
    if (root) await act(async () => root.unmount());
    dom?.window.close();
    if (linked) unlinkSync(link);
    rmSync(temporary, {recursive: true, force: true});
}
