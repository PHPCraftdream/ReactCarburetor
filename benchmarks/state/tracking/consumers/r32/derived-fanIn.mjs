// A/B over prebuilt distributions, one child process per measurement so the two builds never
// share module singletons; does not build or run tests.
// BASELINE_DIST=<baseline-dist> AFTER_DIST=<fixed-dist> \
//   NODE_ENV=production node benchmarks/state/tracking/consumers/r32/derived-fanIn.mjs
// Gate for the computed fan-in merge (R32-02): at K = 1600 an observed outer computed over K
// per-row computeds sharing one store settles in <= 15 ms per write (baseline: 488 ms).
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const SIZES = [100, 200, 400, 800, 1600];
const WARMUP = 2;
const WRITES = 7;
const CHILDREN = 5;
const GATE_K = 1600;
const GATE_MS = 15;
const median = numbers => [...numbers].sort((x, y) => x - y)[Math.floor(numbers.length / 2)];

/**
 * Times one write + observed outer settle for each fan-in size on one build.
 *
 * @param root - the built distribution directory
 */
const measureChild = async root => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Store/Carburetor.mjs')).href);
    const {computed} = await import(pathToFileURL(resolve(root, 'esm/Carburetor/Derived/computedFactory.mjs')).href);

    const perSize = {};
    for (const k of SIZES) {
        class FanStore extends Carburetor {
            /** Bumps one row's field.
             *
             * @param index - the row to write
             */
            bump(index) { this.update(draft => { draft.rows[index].a++; }); }
        }

        const store = new FanStore({
            rows: Array.from({length: k}, (_, n) => ({a: n, b: n, c: n, d: n, e: n})),
        });
        const inner = Array.from({length: k}, (_, n) =>
            computed(read => { const row = read(store).rows[n]; return row.a + row.b + row.c + row.d + row.e; }));
        const outer = computed(read => inner.reduce((sum, item) => sum + read(item), 0));
        const watcher = outer.subscribe(() => undefined);
        outer.get();

        const samples = [];
        let checksum = 0;
        for (let round = 0; round < WARMUP + WRITES; round++) {
            const start = process.hrtime.bigint();
            store.bump(k - 1 - round);
            checksum = outer.get();
            if (round >= WARMUP) samples.push(Number(process.hrtime.bigint() - start) / 1e6);
        }
        outer.unsubscribe(watcher);
        if (checksum === 0) throw new Error('computed did not walk the rows');
        perSize[k] = median(samples);
    }
    return perSize;
};

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify(await measureChild(process.env.BENCH_ROOT)));
} else {
    if (!process.env.BASELINE_DIST) throw new Error('Set BASELINE_DIST to a built baseline distribution');
    const roots = {baseline: process.env.BASELINE_DIST, fixed: process.env.AFTER_DIST ?? 'dist'};
    const script = fileURLToPath(import.meta.url);
    const results = {baseline: [], fixed: []};

    for (let round = -1; round < CHILDREN; round++) {
        for (const label of round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline']) {
            const child = spawnSync(process.execPath, ['--expose-gc', script], {
                encoding: 'utf8', env: {...process.env, BENCH_ROOT: resolve(roots[label])},
            });
            if (child.status !== 0) throw new Error(`${label} child failed: ${child.stderr || child.error}`);
            if (round >= 0) results[label].push(JSON.parse(child.stdout));
        }
    }

    const summary = {baseline: {}, fixed: {}, ratio: {}};
    for (const k of SIZES) {
        summary.baseline[k] = median(results.baseline.map(sample => sample[k]));
        summary.fixed[k] = median(results.fixed.map(sample => sample[k]));
        summary.ratio[k] = summary.fixed[k] / summary.baseline[k];
    }
    summary.gate = {
        k: GATE_K,
        fixedMs: summary.fixed[GATE_K],
        limitMs: GATE_MS,
        pass: summary.fixed[GATE_K] <= GATE_MS,
    };
    console.log(JSON.stringify(summary, null, 2));
}
