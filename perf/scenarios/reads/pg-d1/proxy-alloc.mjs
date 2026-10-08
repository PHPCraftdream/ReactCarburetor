/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// JS-R14-07: fresh proxies; inspect actual handlers passed to the native Proxy constructor.
// Synchronous sweeping and compilation keep background reclamation out of heap slices.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getHeapStatistics} from 'node:v8';
import {emit, load, median} from '../../../harness/lib.mjs';

if (!process.argv.includes('--child')) {
    const run = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation',
        '--no-concurrent-sweeping', '--no-concurrent-marking',
        '--min-semi-space-size=64', '--max-semi-space-size=64',
        fileURLToPath(import.meta.url), ...process.argv.slice(2), '--child'], {env: process.env, encoding: 'utf8'});
    const line = run.stdout.split('\n').find(text => text.startsWith('@@ '));
    if (run.error || run.status !== 0 || !line) throw new Error(`proxy child: ${run.stderr}`);
    console.log(line);
} else {
    const {Carburetor} = await load();
    const store = new Carburetor({value: 7});
    const record = () => {};
    const keep = Array.from({length: 4000});
    for (let i = 0; i < 12000; i++) store.read(record);
    // Warm the statistics reader too; keep every round and every strict slice comparison.
    const used = () => getHeapStatistics().used_heap_size;
    for (let i = 0; i < 1000; i++) used();
    const samples = [];
    const heapSlices = new Float64Array(15);
    let monotone = true;
    for (let round = 0; round < 3; round++) {
        keep.fill(undefined); globalThis.gc();
        const first = used(); heapSlices[round * 5] = first; let previous = first;
        for (let slice = 0; slice < 4; slice++) {
            for (let j = 0; j < 1000; j++) keep[slice * 1000 + j] = store.read(record);
            const now = used(); heapSlices[round * 5 + slice + 1] = now;
            monotone &&= now > previous; previous = now;
        }
        samples.push((previous - first) / keep.length);
    }
    const NativeProxy = globalThis.Proxy;
    let proxies = 0; let ownTrapFunctions = 0;
    const probe = fn => {
        globalThis.Proxy = new NativeProxy(NativeProxy, {construct(target, args) {
            proxies++;
            for (const key of ['get', 'has', 'ownKeys', 'getOwnPropertyDescriptor', 'getPrototypeOf',
                'setPrototypeOf', 'preventExtensions', 'set', 'defineProperty', 'deleteProperty']) {
                if (Object.hasOwn(args[1], key) && typeof args[1][key] === 'function') ownTrapFunctions++;
            }
            return Reflect.construct(target, args);
        }});
        try { fn(); } finally { globalThis.Proxy = NativeProxy; }
    };
    probe(() => {}); const idleProxies = proxies;
    probe(() => { for (let i = 0; i < 4000; i++) keep[i] = store.read(record); });
    const freshProxies = proxies; const freshOwnTraps = ownTrapFunctions;
    proxies = 0; ownTrapFunctions = 0;
    probe(() => { for (let i = 0; i < 4; i++) new Proxy({}, {get: () => 7, has: () => true}); });
    const controlKeep = Array.from({length: 4000});
    globalThis.gc(); const controlStart = used();
    for (let i = 0; i < 4000; i++) controlKeep[i] = {a: i, b: i, c: i};
    const controlBytes = (used() - controlStart) / 4000;
    emit({bytesPerProxy: median(samples), controlBytes, freshProxies, freshOwnTraps, idleProxies,
        controlProxies: proxies, controlOwnTraps: ownTrapFunctions, monotone,
        heapSlices: Array.from(heapSlices).join(','),
        done: controlKeep[3999].c === 3999 && keep.length === 4000 && keep.every(view => view.value === 7)});
}
