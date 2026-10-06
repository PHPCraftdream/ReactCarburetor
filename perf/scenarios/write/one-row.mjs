/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R32-05: one changed row must cost O(changed) allocations and a near-copy diff, not a field
// walk per unchanged element. Costs are gated as ratios to a plain JS array copy of the same
// rows, taken in this process. Allocated bytes come from a grandchild whose huge young
// generation keeps scavenges out of the measurement window, so heapUsed growth over the
// window is allocated bytes (~3750 KB/op pre-fix, ~9 KB now).
// Args: [rows=10000] [samples=60]
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emit, load, loadPath, median} from '../../harness/lib.mjs';

const {Carburetor} = await load();
const rows = Number(process.argv[2] ?? 10000);
const samples = Number(process.argv[3] ?? 60);
const at = Math.min(500, rows - 1);
const makeRows = size => Array.from({length: size}, (_, id) => ({id, title: 't' + id, done: false}));
const replaceRow = list => list.map((row, index) => index === at ? {...row, done: true} : row);

if (process.argv.includes('alloc-probe')) {
    const {diffPaths} = await loadPath('Carburetor/Store/Paths/Diff/diffPaths.mjs');
    const rawOld = {rows: makeRows(rows)};
    const rawNew = {rows: replaceRow(rawOld.rows)};
    for (let i = 0; i < 3; i++) diffPaths(rawOld, rawNew);
    const OPS = 32;
    const windows = [];
    for (let w = 0; w < 5; w++) {
        global.gc();
        const before = process.memoryUsage().heapUsed;
        for (let op = 0; op < OPS; op++) diffPaths(rawOld, rawNew);
        windows.push((process.memoryUsage().heapUsed - before) / OPS / 1024);
    }
    emit({allocKb: median(windows), allocMinKb: Math.min(...windows)});
} else {
    class S extends Carburetor { run(fn) { this.update(fn); } }
    const store = new S({rows: makeRows(rows), other: 0});
    const kept = store.getData().rows[0];
    global.gc?.();
    const setDataMs = [];
    for (let round = 0; round < samples; round++) {
        const fresh = replaceRow(store.getData().rows);
        const start = performance.now();
        store.run(d => { d.rows = fresh; });
        setDataMs.push(performance.now() - start);
    }

    const {diffPaths} = await loadPath('Carburetor/Store/Paths/Diff/diffPaths.mjs');
    const rawOld = {rows: makeRows(rows)};
    const rawNew = {rows: replaceRow(rawOld.rows)};
    const diffMs = [];
    let diffSize = 0;
    for (let round = 0; round < samples; round++) {
        const start = performance.now();
        const changed = diffPaths(rawOld, rawNew);
        diffSize = changed.size;
        diffMs.push(performance.now() - start);
    }

    const child = spawnSync(process.execPath, [
        '--expose-gc', '--max-semi-space-size=1024', '--min-semi-space-size=1024',
        fileURLToPath(import.meta.url), String(rows), 'alloc-probe',
    ], {env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    const line = child.stdout.split('\n').reverse().find(text => text.startsWith('@@ '));
    if (child.status !== 0 || !line) {
        throw new Error(`alloc probe failed (${child.status}):\n${child.stdout}\n${child.stderr}`);
    }
    const {allocKb, allocMinKb} = JSON.parse(line.slice(3));

    // The machine-independent cost yardstick: a plain JS copy of the same rows, same process.
    const copyMs = [];
    for (let round = 0; round < samples; round++) {
        const start = performance.now();
        const copy = rawOld.rows.map(row => row);
        if (copy.length !== rows || copy[0] !== rawOld.rows[0]) throw new Error('copy lost rows');
        copyMs.push(performance.now() - start);
    }

    emit({
        setDataMs: median(setDataMs), diffMs: median(diffMs), copyMs: median(copyMs),
        allocKb, allocMinKb, diffSize,
        rowChanged: store.getData().rows[at].done === true,
        rowKept: store.getData().rows[0] === kept,
    });
}
