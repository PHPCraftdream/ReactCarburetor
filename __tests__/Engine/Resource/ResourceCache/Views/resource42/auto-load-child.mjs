import assert from 'node:assert/strict';
import {existsSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {JSDOM} from 'jsdom';
import {checkFailedRetry} from '../../../../../../perf/scenarios/resource42/failed-retry.mjs';
import {bundleFormat, createFixture, importPart} from './fixture.mjs';
import {checkPreloaderDisarm} from '../../../../../../perf/scenarios/resource42/boundaries.mjs';
import {
    checkRemoval, checkDisarm, checkRefresh, checkWarm, remove,
} from '../../../../../../perf/scenarios/resource42/checks.mjs';

process.env.NODE_ENV = 'development';
const dom = new JSDOM('<!doctype html><body></body>', {url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const {createRoot} = await import('react-dom/client');
const dist = resolve(process.env.DIST_ROOT ?? 'dist/esm-prod');
const engine = await importPart(dist, 'Carburetor');
const interop = await importPart(dist, 'Interop');
const env = {React, createRoot, api: engine, interop};
const events = [];
const observe = (reason, promise) => events.push({reason, promise});
process.on('unhandledRejection', observe);
const turn = () => new Promise(done => setImmediate(done));
const failures = [];
const fixture = createFixture('ownership');
try {
    const selectedFormat = bundleFormat(dist);
    const copied = fixture.copy(dist, `${selectedFormat}-selected`);
    const oppositeFormat = selectedFormat === 'esm' ? 'cjs' : 'esm';
    const oppositeExtension = oppositeFormat === 'esm' ? 'mjs' : 'js';
    const oppositeNames = dist.endsWith('-prod')
        ? [`${oppositeFormat}-prod`, oppositeFormat] : [oppositeFormat, `${oppositeFormat}-prod`];
    const oppositeRoot = oppositeNames.map(name => resolve(dirname(dist), name)).find(root =>
        existsSync(resolve(root, 'Carburetor', `index.${oppositeExtension}`)));
    const copies = {[selectedFormat]: copied};
    if (oppositeRoot) {
        copies[oppositeFormat] = fixture.copy(oppositeRoot, `${oppositeFormat}-opposite`);
    }
    const exportsFor = part => Object.fromEntries(Object.entries(copies).map(([format, root]) => [
        format === 'esm' ? 'import' : 'require',
        `./${root.slice(fixture.root.length + 1).replaceAll('\\', '/')}/${part}/index.${
            format === 'esm' ? 'mjs' : 'js'}`,
    ]));
    writeFileSync(resolve(fixture.root, 'package.json'), JSON.stringify({
        name: 'react-carburetor-r42-copy', type: 'module',
        exports: {'./engine': exportsFor('Carburetor'), './interop': exportsFor('Interop')},
    }));
    writeFileSync(resolve(fixture.root, 'package-entry.mjs'),
        "import * as engine from 'react-carburetor-r42-copy/engine';\n" +
        "import * as interop from 'react-carburetor-r42-copy/interop';\nexport {engine, interop};");
    writeFileSync(resolve(fixture.root, 'package-entry.cjs'),
        "module.exports = {engine: require('react-carburetor-r42-copy/engine'),\n" +
        "interop: require('react-carburetor-r42-copy/interop')};");
    let preloaderRetirements = 0, retiredLoads = 0, registrationBalance = 0, activeRegistrations = 0;
    const recordRetirement = result => {
        preloaderRetirements += result.preloaderRetirements;
        retiredLoads += result.retiredLoads;
        registrationBalance += result.registrationBalance;
        activeRegistrations += result.activeRegistrations;
    };
    let warm;
    let restoredLoading = 0, expectedGlobalRejections = 0, explicitCaught = 0, visibleUnexpected = 0;
    async function lane(name, fn, expected = 0) {
        const before = events.length;
        try { await fn(); } catch (error) { failures.push(`${name}: ${error.message}`); }
        await turn();
        const actual = events.slice(before);
        if (expected === 0) expectedGlobalRejections += actual.length;
        else {
            if (actual.length !== expected || actual.some(event => event.reason !== expectedError)) {
                failures.push(`${name}: unexpected source/callback rejection visibility was lost`);
            } else visibleUnexpected++;
        }
    }
    let expectedError;
    for (const kind of ['hook', 'class']) {
        for (const action of ['abort', 'forget', 'restore', 'forgetAll']) {
            for (const phase of ['before', 'replacement', 'after']) {
                await lane(`${kind}/${action}/${phase}`, async () => {
                    const result = await checkRemoval(env, {kind, action, phase});
                    restoredLoading += result.restoredLoading;
                    if (phase !== 'after') {
                        assert.equal(result.caught.length, 1, 'original public load must still reject once');
                        assert.equal(result.caught[0].name, 'AbortError');
                        assert.equal(events.some(event => result.originals.has(event.promise)), false,
                            'original load is caught; any global rejection belongs to dropped child');
                    }
                });
            }
            await lane(`${kind}/${action}/refresh-failed-retry`, () => checkRefresh(env, kind, action));
            await lane(`${kind}/${action}/pre-loader-failed-retry`, () => checkFailedRetry(env, kind, action));
        }
        for (const strict of [false, true]) for (const mode of ['source', 'args', 'unmount']) {
            await lane(`${kind}/preloader-disarm/${mode}/strict=${strict}`, async () => {
                recordRetirement(await checkPreloaderDisarm(env, {kind, mode, strict}));
            });
            await lane(`${kind}/disarm/${mode}/strict=${strict}`, () => checkDisarm(env, {kind, mode, strict}));
        }
        for (const field of [false, true]) for (const foreignAbort of [false, true]) {
            await lane(`${kind}/custom/field=${field}/foreignAbort=${foreignAbort}`, async () => {
                expectedError = new Error('unexpected');
                if (foreignAbort) expectedError.name = 'AbortError';
                const source = new engine.ResourceCache(async () => ({name: 'unused'}), {ttl: Infinity});
                if (!field) {
                    const original = source.resolve.bind(source);
                    source.resolve = args => ({...original(args), fieldView: undefined});
                }
                source.load = () => Promise.reject(expectedError);
                const container = document.createElement('div');
                const root = createRoot(container);
                function Hook() {
                    const value = interop.useResourceValue(source, 'x', view => view.data?.name);
                    return React.createElement('p', null, value ?? 'loading');
                }
                class Owner extends engine.AntiHookComponent {
                    render() {
                        return React.createElement('p', null, this.useResource(source, 'x').data?.name ?? 'loading');
                    }
                }
                await React.act(async () => root.render(React.createElement(kind === 'hook' ? Hook : Owner)));
                assert.equal(container.textContent, 'loading');
                await React.act(async () => root.unmount());
            }, 1);
        }
        for (const failure of ['publication', 'callback']) {
            await lane(`${kind}/${failure}`, async () => {
                expectedError = new Error(failure);
                const request = Promise.withResolvers();
                const explicitFailures = [];
                const originals = new Set();
                let publicationAttempts = 0;
                /** Rejects genuine successful publication, not subscriber delivery or load itself. */
                class RejectingPublicationCache extends engine.ResourceCache {
                    preEmit() {
                        super.preEmit();
                        const entry = this.data.entries[this.resolve('x').key];
                        if (entry?.status === 'success' && entry.data?.name === 'ready') {
                            publicationAttempts++;
                            throw expectedError;
                        }
                    }
                }
                const source = failure === 'publication'
                    ? new RejectingPublicationCache(() => request.promise, {ttl: Infinity})
                    : new engine.ResourceCache(() => request.promise, {ttl: Infinity});
                if (failure === 'callback') source.load = () => request.promise;
                else {
                    const load = source.load.bind(source);
                    source.load = args => {
                        const original = load(args);
                        originals.add(original);
                        void original.catch(error => explicitFailures.push(error));
                        return original;
                    };
                }
                let mounted = false;
                const container = document.createElement('div');
                const root = createRoot(container);
                function Hook() {
                    React.useEffect(() => {
                        mounted = true;
                        return () => { mounted = false; };
                    }, []);
                    const value = interop.useResourceValue(source, 'x', view => view.data?.name);
                    return React.createElement('p', null, value ?? 'loading');
                }
                class Owner extends engine.AntiHookComponent {
                    componentDidMount() {
                        super.componentDidMount();
                        mounted = true;
                    }
                    componentWillUnmount() {
                        super.componentWillUnmount();
                        mounted = false;
                    }
                    render() {
                        return React.createElement('p', null, this.useResource(source, 'x').data?.name ?? 'loading');
                    }
                }
                await React.act(async () => root.render(React.createElement(kind === 'hook' ? Hook : Owner)));
                assert.equal(mounted, true, 'consumer mounted before terminal settlement');
                if (failure === 'callback') source.resolve = () => { throw expectedError; };
                await React.act(async () => {
                    request.resolve({name: 'ready'});
                    await turn();
                });
                assert.equal(mounted, true, 'consumer stays mounted during terminal failure');
                if (failure === 'publication') {
                    assert.equal(publicationAttempts, 1, 'real successful settlement must attempt publication');
                    assert.deepEqual(explicitFailures, [expectedError], 'public load must reject with exact publication failure');
                    assert.equal(events.some(event => originals.has(event.promise)), false,
                        'caught public original is distinct from the globally visible dropped consumer child');
                    // preEmit can reject after installing Success; a hook recheck may adopt it.
                    // Mount lifetime, not rollback or a particular rendered status, is the oracle.
                }
                if (failure === 'callback') {
                    source.resolve = () => ({key: 'x', path: 'x', present: false, view: {status: 'idle'}});
                }
                await React.act(async () => root.unmount());
                assert.equal(mounted, false, 'consumer lifecycle records explicit unmount');
            }, 1);
        }
    }
    for (const action of ['abort', 'forget', 'restore', 'forgetAll']) {
        await lane(`explicit/${action}`, async () => {
            const cache = new engine.ResourceCache(async () => { throw new Error('obsolete loader ran'); });
            let fired = false;
            const id = cache.subscribe(() => {
                if (fired) return;
                fired = true;
                remove(cache, action);
            }, {reads: new Set([cache.resolve('x').path])});
            await assert.rejects(cache.load('x'), error => error.name === 'AbortError');
            explicitCaught++;
            cache.unsubscribe(id);
        });
    }
    await lane('warm', async () => {
        warm = await checkWarm(env);
        registrationBalance += warm.registrationBalance;
        activeRegistrations += warm.activeRegistrations;
    });
    const otherRoot = process.env.R42_COPY_ROOT;
    const roots = [...Object.values(copies), ...(otherRoot ? [resolve(otherRoot)] : []),
        ...(copies[oppositeFormat] ? [oppositeRoot] : [])];
    async function ownershipCopy(name, other) {
        // Consumers remain from the selected distribution; source ownership comes from the copy.
        const cross = {...env, api: {...engine, ResourceCache: other.ResourceCache}};
        for (const kind of ['hook', 'class']) {
            await lane(`${kind}/${name}`, () => checkRemoval(cross, {kind, action: 'forget'}));
            for (const strict of [false, true]) for (const mode of ['source', 'args', 'unmount']) {
                await lane(`${kind}/${name}/preloader/${mode}/strict=${strict}`, async () => {
                    recordRetirement(await checkPreloaderDisarm(cross, {kind, mode, strict}));
                });
            }
        }
    }
    for (const root of roots) await ownershipCopy(`physical-copy/${root}`, await importPart(root, 'Carburetor'));
    for (const format of Object.keys(copies)) {
        const extension = format === 'esm' ? 'mjs' : 'cjs';
        const packageCopy = await import(pathToFileURL(resolve(fixture.root, `package-entry.${extension}`)).href);
        await ownershipCopy(`package-copy/${format}`, (packageCopy.default ?? packageCopy).engine);
    }
    assert.equal(expectedGlobalRejections, 0,
        'R42-R02 automatic owned load left a global rejection ' +
        '(caught original does not catch dropped child)');
    assert.deepEqual(failures, [], 'R42 resource consumer behavior failures');
    console.log('@@ ' + JSON.stringify({restoredLoading, expectedGlobalRejections, explicitCaught, visibleUnexpected,
        ...warm, preloaderRetirements, retiredLoads, registrationBalance, activeRegistrations}));
} finally {
    process.removeListener('unhandledRejection', observe);
    dom.window.close();
    fixture.cleanup();
}
