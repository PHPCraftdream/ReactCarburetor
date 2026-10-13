import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {distRoot, emit, median} from '../../harness/lib.mjs';
const esm = resolve(distRoot, 'Carburetor/index.mjs');
const api = existsSync(esm) ? await import(pathToFileURL(esm).href)
    : createRequire(import.meta.url)(resolve(distRoot, 'Carburetor/index.js'));
class Store extends api.Carburetor {
    /** Completes a public update. */
    run(fn) { this.update(fn); }
}
const [occupied = 8, length = 64] = process.argv.slice(2).map(Number);
const results = [];
let completed = 0, canceled = 0;
// Separate processes from work counters; no intrinsic instrumentation in these completed operations.
for (const prototype of [Array.prototype, null, Object.prototype]) {
    for (const shape of ['dense', 'sparse']) for (const lane of ['graph', 'projection', 'scalar', 'noop']) {
        const rows = []; rows.length = shape === 'dense' ? occupied : length;
        for (let i = 0; i < occupied; i++) rows[shape === 'dense' ? i : i * Math.floor(length / occupied)] = {n: 0};
        Object.setPrototypeOf(rows, prototype);
        const store = new Store({rows});
        let callbacks = 0, checksum = 0;
        const selector = lane === 'projection' ? d => ({rows: d.rows})
            : lane === 'scalar' ? d => d.rows[0].n : d => d.rows;
        const stop = store.watch(selector, next => {
            callbacks++; checksum += lane === 'scalar' ? next : lane === 'projection' ? next.rows[0].n : next[0].n;
        });
        const samples = [];
        try {
            for (let sample = 0; sample < 9; sample++) {
                const start = performance.now();
                for (let i = 0; i < 128; i++) store.run(d => {
                    d.rows[0].n = lane === 'noop' ? 0 : sample * 128 + i + 1;
                });
                const elapsed = performance.now() - start;
                if (sample >= 2) samples.push(elapsed);
            }
            assert.equal(store.getData().rows[0].n, lane === 'noop' ? 0 : 1152);
            assert.equal(callbacks, lane === 'noop' ? 0 : 1152);
            assert.equal(checksum, lane === 'noop' ? 0 : 1152 * 1153 / 2);
            if (lane === 'noop') canceled += 1152; else completed += 1152;
            results.push({prototype: prototype === null ? 'null' : prototype === Array.prototype ? 'array' : 'object',
                shape, lane, ms: median(samples), callbacks, checksum});
        } finally { stop(); }
    }
}
emit({completed, canceled, lanes: results.length, samples: 7, correct: true, results});
