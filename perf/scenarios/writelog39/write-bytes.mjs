/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// R39-04: heap bytes per write. A child with a 64 MB semi-space runs the writes, so no scavenge
// (which would shrink the used heap) happens inside a measured slice; `monotone` proves it.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {getHeapSpaceStatistics, getHeapStatistics} from 'node:v8';
import {emit, load, median} from '../../harness/lib.mjs';

if (!process.argv.includes('--child')) {
    const run = spawnSync(process.execPath, ['--expose-gc', '--min-semi-space-size=64', '--max-semi-space-size=64',
        fileURLToPath(import.meta.url), ...process.argv.slice(2), '--child'],
    {env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
    const line = run.stdout.split('\n').reverse().find(text => text.startsWith('@@ '));
    if (run.error || run.status !== 0 || !line) throw new Error(`write-bytes child exited ${run.status}: ${String(run.stderr).slice(0, 200)}`);
    console.log(line);
} else {
    const {Carburetor} = await load();
    const count = Number(process.argv[2] ?? 6000);
    const warm = 1500;
    const slices = 6;
    const rounds = 3;
    // Builds without the opt-in have no such method and record proofs on every write.
    const track = Symbol.for('react-carburetor/v1/store-track-targets');
    class Store extends Carburetor { change(fn) { this.update(fn); } }
    const used = () => getHeapStatistics().used_heap_size;
    let monotone = true;
    let toggleAvailable = true;
    let consumerOk = true;
    let stateOk = true;
    const measure = kind => {
        const store = new Store({tick: 0, rows: [{a: 0}]});
        if (kind === 'on') {
            toggleAvailable &&= typeof store[track] === 'function';
            store[track]?.();
        }
        let seq = 0;
        let seen = 0;
        const stop = kind === 'consumer' ? store.watch(d => d.rows, () => { seen++; }) : undefined;
        const apply = d => { d.rows[0].a = ++seq; };
        for (let i = 0; i < warm; i++) store.change(apply);
        globalThis.gc();
        const per = Math.floor(count / slices);
        const first = used();
        let previous = first;
        const start = performance.now();
        for (let slice = 0; slice < slices; slice++) {
            for (let i = 0; i < per; i++) store.change(apply);
            const now = used();
            monotone &&= now > previous;
            previous = now;
        }
        const ms = performance.now() - start;
        stateOk &&= store.getData().rows[0].a === seq;
        if (stop) {
            consumerOk &&= seen === seq;
            stop();
        }
        return {bytes: (previous - first) / (per * slices), ms: ms / (per * slices)};
    };
    const kinds = ['off', 'on', 'consumer'];
    const results = {off: [], on: [], consumer: []};
    for (let round = 0; round < rounds; round++) {
        for (let offset = 0; offset < kinds.length; offset++) {
            const kind = kinds[(round + offset) % kinds.length];
            results[kind].push(measure(kind));
        }
    }
    const bytes = kind => median(results[kind].map(item => item.bytes));
    const perWriteMs = kind => median(results[kind].map(item => item.ms));
    // Positive control: the heap counter resolves small retained objects (3-property objects, >= 32 B).
    const refCount = 20000;
    globalThis.gc();
    const refStart = used();
    const keep = Array.from({length: refCount});
    for (let i = 0; i < refCount; i++) keep[i] = {a: i, b: i, c: i};
    const refBytes = (used() - refStart) / refCount;
    const keepOk = keep[refCount - 1].c === refCount - 1;
    const newSpaceMB = (getHeapSpaceStatistics().find(space => space.space_name === 'new_space')?.space_size ?? 0) / 1048576;
    emit({
        writes: count, offBytes: bytes('off'), onBytes: bytes('on'), consumerBytes: bytes('consumer'),
        savedBytes: bytes('on') - bytes('off'), refBytes, newSpaceMB, toggleAvailable, monotone, consumerOk,
        offWriteMs: perWriteMs('off'), onWriteMs: perWriteMs('on'), consumerWriteMs: perWriteMs('consumer'),
        done: stateOk && consumerOk && keepOk,
    });
}
