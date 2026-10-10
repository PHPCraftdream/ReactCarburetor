/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Separate process liveness gate: all caches remain strongly reachable throughout full GCs.
// No unit-test GC timing assumption, no resolve/getEntry after removal to hide an obsolete memo.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setImmediate as turn} from 'node:timers/promises';
import {emit, load} from '../../harness/lib.mjs';
if (!process.argv.includes('--child')) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url), '--child'],
        {encoding: 'utf8', env: process.env});
    if (child.error || child.status !== 0) throw new Error(child.error?.message ?? child.stdout + child.stderr);
    process.stdout.write(child.stdout);
} else {
const {ResourceCache, EResourceStatus} = await load();
if (typeof globalThis.gc !== 'function') throw new Error('Run with --expose-gc');
class Cache extends ResourceCache {
    change(fn) { this.update(fn); }
}
const entry = data => ({status: EResourceStatus.Success, data, error: undefined,
    updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false});
const payload = label => ({label, bytes: new Uint8Array(1024 * 1024)});
const routes = ['forget', 'forgetAll', 'setData-remove', 'setData-replace', 'restore',
    'fromJSON', 'draft-remove', 'draft-replace', 'refresh', 'eviction'];
const live = [];
let stableChecks = 0;
let captured;
// Each fixture exits its activation before GC; neither loader nor result closes over the payload.
const prepare = async route => {
    const cache = new Cache(async () => ({label: 'new'}), {ttl: Infinity, maxEntries: route === 'eviction' ? 1 : Infinity});
    const old = payload(route);
    const ref = new WeakRef(old);
    // Obtain the encoding before payload installation. Do not expose internal symbols to the test.
    const key = cache.resolve('old').key;
    cache.setData({entries: {[key]: entry(old)}});
    const resolution = cache.resolve('old');
    if (cache.resolve('old') === resolution) stableChecks++;
    switch (route) {
        case 'forget': cache.forget('old'); break;
        case 'forgetAll': cache.forgetAll(); break;
        case 'setData-remove': cache.setData({entries: {}}); break;
        case 'setData-replace': cache.setData({entries: {[key]: entry({label: 'new'})}}); break;
        case 'restore': cache.restore({entries: {}}); break;
        case 'fromJSON': cache.fromJSON({entries: {}}); break;
        case 'draft-remove': cache.change(d => { delete d.entries[key]; }); break;
        case 'draft-replace': cache.change(d => { d.entries[key].data = {label: 'new'}; }); break;
        case 'refresh': await cache.refresh('old'); break;
        case 'eviction': await cache.load('new'); break;
    }
    // Caller-owned snapshots must never be mutated or data-retargeted by cleanup.
    if (resolution.view.data !== old || resolution.view.data.label !== route) {
        throw new Error('Captured resolution changed: ' + route);
    }
    const current = cache.getData().entries[key];
    if (current?.data === old) throw new Error('Fixture did not remove/replace old payload: ' + route);
    live.push(cache);
    return ref;
};
const refs = [];
for (const route of routes) refs.push(await prepare(route));
// Positive controls: one live entry and one public captured resolution after removal.
const prepareControls = () => {
    const cache = new Cache(async () => ({label: 'unused'}), {ttl: Infinity});
    const key = cache.resolve('control').key;
    const strong = payload('strong');
    cache.setData({entries: {[key]: entry(strong)}});
    cache.resolve('control');
    live.push(cache);
    const heldCache = new Cache(async () => ({label: 'unused'}), {ttl: Infinity});
    const heldKey = heldCache.resolve('captured').key;
    const held = payload('captured');
    heldCache.setData({entries: {[heldKey]: entry(held)}});
    captured = heldCache.resolve('captured');
    heldCache.forget('captured');
    live.push(heldCache);
    return {strong: new WeakRef(strong), held: new WeakRef(held)};
};
const controls = prepareControls();
const collect = async () => {
    // Yield before each collection: WeakRef targets created/dereferenced in the prior job
    // cannot be collected until that job ends. Fixtures have already returned their frames.
    for (let i = 0; i < 12; i++) {
        await turn();
        globalThis.gc();
    }
    await turn();
};
await collect();
const released = refs.map(ref => ref.deref() === undefined);
const strongAlive = controls.strong.deref()?.label === 'strong';
const capturedAlive = controls.held.deref()?.label === 'captured' && captured.view.data.label === 'captured';
captured = undefined;
await collect();
const capturedReleased = controls.held.deref() === undefined;
// Actual post-GC reads keep every cache live, not just an unused lexical declaration.
const cachesAlive = live.length === routes.length + 2 && live.every(cache => cache.getData().entries !== undefined);
emit({cases: routes.length, collected: released.filter(Boolean).length,
    failedCases: routes.filter((_route, i) => !released[i]).join(','), stableChecks,
    strongAlive, capturedAlive, capturedReleased, cachesAlive});
}
