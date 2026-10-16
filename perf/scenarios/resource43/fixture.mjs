/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {engine} from '../../harness/lib.mjs';

// DIST_ROOT wins; --root/--env permit direct invocations without consuming dimension arguments.
export const option = (name, fallback) => {
    const at = process.argv.indexOf('--' + name);
    return at < 0 ? fallback : process.argv[at + 1];
};
export const root = resolve(process.env.DIST_ROOT ?? option('root', 'dist/esm-prod'));
process.env.NODE_ENV = option('env', process.env.NODE_ENV ?? 'production');
export const format = existsSync(resolve(root, 'Carburetor/index.mjs')) ? 'esm' : 'cjs';
const require = createRequire(import.meta.url);
export const api = format === 'esm'
    ? await import(pathToFileURL(resolve(root, 'Carburetor/index.mjs')).href)
    : require(resolve(root, 'Carburetor/index.js'));
export const entry = data => ({status: api.EResourceStatus.Success, data, error: undefined,
    updatedAt: Date.now(), refreshing: false, invalidated: false, failed: false});
export const encoded = args => JSON.stringify(args === undefined ? null : args).replaceAll('~', '~0').replaceAll('.', '~1');
export const dimension = (name, fallback, max) => {
    const n = Number(option(name, fallback));
    assert.ok(Number.isInteger(n) && n >= 1 && n <= max, name + ' out of bounds');
    return n;
};
export function fixture(options = {}) {
    const requests = [], promises = [];
    const cache = new api.ResourceCache((id, signal) => new Promise((yes, no) => {
        requests.push({id, signal, yes, no});
    }), {ttl: Infinity, maxEntries: 1, ...options});
    const start = (id, refresh = false) => {
        const p = refresh ? cache.refresh(id) : cache.load(id);
        promises.push(p);
        return p;
    };
    const stored = id => cache.getData().entries[encoded(id)];
    const close = async () => {
        cache.abortAll();
        requests.forEach(r => r.yes('cleanup'));
        await Promise.all(promises);
        cache.clear();
        assert.equal(Object.keys(cache.getData().entries).length, 0);
    };
    return {cache, requests, promises, start, stored, close};
}
// Fail loudly if internals change. Used ONLY in deterministic work lanes, never timing lanes.
export function victimCounter(cache) {
    const ledger = engine(cache, 'eviction');
    assert.equal(typeof ledger?.selectVictims, 'function', 'eviction instrumentation unavailable');
    const original = ledger.selectVictims;
    const counter = {scans: 0, visits: 0, reset() { this.scans = this.visits = 0; },
        restore() { ledger.selectVictims = original; }};
    ledger.selectVictims = function(capacity, predicate) {
        counter.scans++;
        return original.call(this, capacity, key => { counter.visits++; return predicate(key); });
    };
    return counter;
}
