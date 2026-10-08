/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R36-07: class props comparisons, isolated from React scheduling and fixture allocation.
// Synchronous sweeping prevents post-GC reclamation from making a zero-allocation slice shrink.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getHeapStatistics} from 'node:v8';
import {emit, load, median} from '../../../../harness/lib.mjs';

if (!process.argv.includes('--child')) {
    const run = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-sweeping', '--no-concurrent-marking',
        '--min-semi-space-size=64', '--max-semi-space-size=64',
        fileURLToPath(import.meta.url), ...process.argv.slice(2), '--child'], {env: process.env, encoding: 'utf8'});
    const line = run.stdout.split('\n').find(text => text.startsWith('@@ '));
    if (run.error || run.status !== 0 || !line) throw new Error(`props child: ${run.stderr}`);
    console.log(line);
} else {
    const {AntiHookComponent} = await load();
    const left = {a: 1, b: 2, c: 3}; const right = {a: 1, b: 2, c: 3};
    const row = new AntiHookComponent(left);
    const compare = () => row.shouldComponentUpdate(right, row.state);
    const copying = () => {
        const keys = Object.keys(left);
        return keys.length !== Object.keys(right).length || !keys.every(key => Object.is(left[key], right[key]));
    };
    let accepted = 0;
    const loop = fn => { for (let i = 0; i < 10000; i++) if (!fn()) accepted++; };
    for (let i = 0; i < 10; i++) { loop(compare); loop(copying); }
    const used = () => getHeapStatistics().used_heap_size;
    for (let i = 0; i < 1000; i++) used();
    let monotone = true;
    const measure = fn => {
        globalThis.gc();
        const first = used();
        let previous = first;
        for (let i = 0; i < 5; i++) {
            for (let j = 0; j < 2000; j++) if (!fn()) accepted++;
            const now = used(); monotone &&= now >= previous; previous = now;
        }
        return (previous - first) / 1024;
    };
    measure(compare); measure(copying);
    accepted = 200000; monotone = true;
    const allocations = []; const controls = [];
    for (let i = 0; i < 3; i++) { allocations.push(measure(compare)); controls.push(measure(copying)); }
    const original = Object.keys;
    let keyCopies = 0;
    Object.keys = function (value) { if (value === left || value === right) keyCopies++; return original(value); };
    let controlKeyCopies;
    try {
        loop(compare);
        const propsKeyCopies = keyCopies;
        keyCopies = 0; loop(copying); controlKeyCopies = keyCopies; keyCopies = propsKeyCopies;
    } finally { Object.keys = original; }
    const changed = row.shouldComponentUpdate({a: 2, b: 2, c: 3}, row.state);
    emit({allocatedKB: median(allocations), copyingKB: median(controls), keyCopies, controlKeyCopies,
        monotone, done: accepted === 280000 && changed && compare() === false});
}
