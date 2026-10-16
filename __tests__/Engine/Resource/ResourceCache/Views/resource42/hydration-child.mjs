import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {createFixture, importPart} from './fixture.mjs';
import {JSDOM} from 'jsdom';

process.env.NODE_ENV = 'development';
const reactRoot = resolve(process.env.REACT_ROOT ?? '.');
const require = createRequire(resolve(reactRoot, 'package.json'));
const React = require('react');
const {renderToString} = require('react-dom/server');
const fixture = createFixture('hydrate', resolve(reactRoot, 'node_modules'));
try {
const dist = resolve(process.env.DIST_ROOT ?? 'dist/esm-prod');
const serverDir = fixture.copy(dist, 'server');
const api = await importPart(serverDir, 'Carburetor');
const serverInterop = await importPart(serverDir, 'Interop');
const cache = new api.ResourceCache(async () => ({name: 'server'}), {ttl: Infinity});
await cache.load('x');
function Server() {
    return React.createElement('p', null, serverInterop.useResourceValue(cache, ['x'], view => view.data?.name));
}
const markup = renderToString(React.createElement(Server));
assert.equal(markup, '<p>server</p>', 'SSR selected data must be visible');
const dom = new JSDOM('<!doctype html><body><div id="root">' + markup + '</div></body>', {url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Node']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const clientDir = fixture.copy(dist, 'client');
const {ResourceCache} = await importPart(clientDir, 'Carburetor');
const {useResourceValue} = await importPart(clientDir, 'Interop');
const {hydrateRoot} = require('react-dom/client');
const act = React.act ?? require('react-dom/test-utils').act;
const requests = [];
const client = new ResourceCache(() => {
    const request = Promise.withResolvers();
    requests.push(request);
    return request.promise;
}, {ttl: Infinity});
client.restore(cache.getData());
function Client() { return React.createElement('p', null, useResourceValue(client, ['x'], view => view.data?.name)); }
const container = document.getElementById('root');
const errors = [];
let root;
try {
    await act(async () => {
        root = hydrateRoot(container, React.createElement(Client), {
            onRecoverableError: error => errors.push(error),
        });
    });
    assert.equal(container.textContent, 'server', 'hydration preserves selected SSR DOM');
    assert.equal(requests.length, 0, 'fresh hydrated entry must not reload');
    await act(async () => client.invalidate('x'));
    assert.equal(requests.length, 1, 'hydrated commit must own invalidation demand');
    await act(async () => requests[0].resolve({name: 'client'}));
    assert.equal(container.textContent, 'client', 'hydrated consumer receives settlement');
    assert.deepEqual(errors, [], 'hydration must not require recovery');
    console.log('@@ ' + JSON.stringify({react: React.version,
        hydrationDeliveries: Number(container.textContent === 'client'), recoveryErrors: errors.length}));
} finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
}
} finally {
    fixture.cleanup();
}
