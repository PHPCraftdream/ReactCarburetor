// Positional array methods through draft (R32-03): A/B over prebuilt distributions, one child
// process per measurement so the two builds never share module singletons.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> NODE_ENV=production \
//   node benchmarks/state/tracking/consumers/r32/array-positional.mjs
// Gates: splice(0,1) <= 15 ms without subscribers, <= 50 ms with 10k row readers;
// splice(5000,1), shift, unshift, reverse, sort <= 25 ms without subscribers.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROWS = 10000;
const WARMUP = 2;
const REPEAT = 7;
const CHILDREN = 5;
const median = numbers => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];

/**
 * Times one positional operation with or without one subscriber per row.
 *
 * @param root - the built distribution directory
 * @param op - the recipe run inside update()
 * @param withSubscribers - whether every row gets a reader subscribed to its title
 */
const measureChild = async (root, op, withSubscribers) => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm-prod/Carburetor/index.mjs')).href);

    class Store extends Carburetor {
        /** Runs one recipe inside a tracked update. */
        run(fn) { this.update(fn); }
    }

    const makeRows = () => Array.from({length: ROWS}, (_, n) =>
        ({id: n, title: 't' + n, done: n % 2 === 0, a: n * 3, b: n % 5, c: 10 - n}));
    const store = new Store({rows: makeRows()});

    if (withSubscribers) {
        for (let index = 0; index < ROWS; index++) {
            const path = 'rows.' + index + '.title';
            store.subscribe(() => undefined, {id: 'r' + index, reads: new Set([path])});
        }
    }

    const samples = [];
    let checksum = 0;
    for (let round = 0; round < WARMUP + REPEAT; round++) {
        store.setData({rows: makeRows()});
        const start = process.hrtime.bigint();
        store.run(op);
        if (round >= WARMUP) samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        checksum += store.getData().rows.length;
    }
    if (checksum === 0) throw new Error('no rows survived');
    return median(samples);
};

const OPS = {
    spliceHead: draft => { draft.rows.splice(0, 1); },
    spliceMid: draft => { draft.rows.splice(5000, 1); },
    shift: draft => { draft.rows.shift(); },
    unshift: draft => { draft.rows.unshift({id: -1, title: 'n', done: false, a: 0, b: 0, c: 0}); },
    reverse: draft => { draft.rows.reverse(); },
    sort: draft => { draft.rows.sort((a, b) => b.id - a.id); },
};

if (process.env.BENCH_ROOT) {
    const label = process.env.BENCH_OP + (process.env.BENCH_SUBS === '1' ? '.subs' : '');
    const ms = await measureChild(
        process.env.BENCH_ROOT, OPS[process.env.BENCH_OP], process.env.BENCH_SUBS === '1'
    );
    console.log(JSON.stringify({[label]: ms}));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
    const results = {};
    const script = fileURLToPath(import.meta.url);

    for (const op of Object.keys(OPS)) {
        for (const subs of ['0', '1']) {
            for (const label of ['baseline', 'fixed']) {
                const samples = [];
                for (let round = 0; round < CHILDREN; round++) {
                    const child = spawnSync(process.execPath, [script], {
                        encoding: 'utf8', timeout: 120000,
                        env: {...process.env, BENCH_ROOT: resolve(roots[label]),
                            BENCH_OP: op, BENCH_SUBS: subs, NODE_ENV: 'production'},
                    });
                    if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
                    samples.push(Object.values(JSON.parse(child.stdout))[0]);
                }
                results[`${op}${subs === '1' ? '.subs' : ''}.${label}`] = median(samples);
            }
        }
    }

    const gates = {};
    for (const op of Object.keys(OPS)) {
        for (const subs of ['0', '1']) {
            const key = `${op}${subs === '1' ? '.subs' : ''}`;
            const limit = key.endsWith('.subs') ? 50 : (op === 'spliceHead' ? 15 : 25);
            gates[key] = {
                baselineMs: results[`${key}.baseline`],
                fixedMs: results[`${key}.fixed`],
                limitMs: limit,
                pass: results[`${key}.fixed`] <= limit,
            };
        }
    }
    console.log(JSON.stringify(gates, null, 2));
}
