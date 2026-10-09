/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R30-08: resource cache resolve() of primitive ids answers from the key memo, no re-serialization;
// the keys themselves must stay byte-identical to the pinned golden strings. Args: [ids=4000] [passes=9]
import {emit, loadPath, median, call} from '../../harness/lib.mjs';

const {ResourceCache} = await loadPath('Carburetor/Resource/Cache/ResourceCache.mjs');

const ids = Number(process.argv[2] ?? 4000);
const passes = Number(process.argv[3] ?? 9);
const args = Array.from({length: ids}, (_, id) => id);
const cache = new ResourceCache(async id => ({id}), {maxEntries: Infinity, ttl: Infinity});

// Golden keys: byte-exact reference keys and paths from the escape contract — a format drift or a
// memo answering with a neighbor's key fails the equals gates.
const GOLDEN = [
    [0, '0', 'entries.0'],
    ['', '""', 'entries.""'],
    ['a.b', '"a~1b"', 'entries."a~01b"'],
    ['x~y', '"x~0y"', 'entries."x~00y"'],
    [true, 'true', 'entries.true'],
    [null, 'null', 'entries.null'],
];
let goldenOk = true;
const goldenSeen = [];
for (const [id, key, path] of GOLDEN) {
    const resolved = await cache.resolve(id);
    goldenSeen.push(resolved.key, resolved.path);
    goldenOk &&= resolved.key === key && resolved.path === path && call(cache, 'keyOf', id) === key;
}

// Warm the key memo so the timed passes measure the cached path.
for (const id of args) await cache.resolve(id);

// Key derivation correctness: memoized keys must match a fresh keyOf, and edge primitives must work.
let keysOk = goldenOk;
for (const id of args) {
    const resolved = await cache.resolve(id);
    keysOk &&= typeof resolved.key === 'string' && resolved.key.length > 0 && resolved.key === call(cache, 'keyOf', id);
    keysOk &&= typeof resolved.path === 'string' && resolved.path.length > 0;
}
for (const edge of [0, NaN, Infinity, 42, '', 'a.b', 'x~y', true, false, null, undefined]) {
    const key = call(cache, 'keyOf', edge);
    keysOk &&= typeof key === 'string' && key.length > 0;
}

// One timed pass with the serialization counter attached: a warm primitive must not stringify.
const onePass = async count => {
    let stringifyCalls = 0;
    const original = JSON.stringify;
    if (count) {
        JSON.stringify = (...a) => {
            stringifyCalls++;
            return original(...a);
        };
    }
    try {
        const start = performance.now();
        for (const id of args) {
            const resolved = await cache.resolve(id);
            if (resolved.key === undefined) keysOk = false;
        }
        return {ms: performance.now() - start, stringifyCalls};
    } finally {
        JSON.stringify = original;
    }
};

const samples = [];
let stringifyCalls = 0;
for (let i = 0; i < passes; i++) {
    const pass = await onePass(i === 0);
    samples.push(pass.ms);
    if (i === 0) stringifyCalls = pass.stringifyCalls;
}

// A cold primitive still derives through serialization, proving the memo is fed by real derivation.
let coldStringifies = 0;
{
    const original = JSON.stringify;
    JSON.stringify = (...a) => {
        coldStringifies++;
        return original(...a);
    };
    try {
        await cache.resolve(-99999);
    } finally {
        JSON.stringify = original;
    }
}

emit({
    resolveMs: median(samples),
    stringifyCalls,
    coldStringifies,
    keysOk,
    goldenOk,
    goldenSeen: goldenSeen.join('|'),
});
