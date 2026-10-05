import {spawnSync} from 'node:child_process';
import {basename, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const SIZES = [1000, 10000];
const CHILDREN = 5;
const median = (numbers) => [...numbers].sort((a, b) => a - b)[Math.floor(numbers.length / 2)];
const normalizeRoot = (root) => {
    const absolute = resolve(root);
    return basename(absolute) === 'esm-prod' ? absolute : resolve(absolute, 'esm-prod');
};

/** Measure the median settle time for one process and row count.
 *
 * @param root - Production ESM build root.
 * @param rowsCount - Number of rows in the test store.
 */
async function measure(root, rowsCount) {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'Carburetor/Store/Carburetor.mjs')).href);
    const {computed} = await import(pathToFileURL(resolve(root, 'Carburetor/Derived/computedFactory.mjs')).href);
    class Store extends Carburetor {
        /** Run a mutation against the store's draft. */
        run(fn) { this.update(fn); }
    }
    const store = new Store({rows: Array.from({length: rowsCount}, (_, i) => ({
        id: i, title: 'title-0', tags: {a: 1},
    }))});
    const c = computed((read) => read(store).rows);
    c.subscribe(() => { void c.get()[5].title; });
    void c.get()[5].title;

    const times = [];
    for (let i = 0; i < 18; i++) {
        const start = process.hrtime.bigint();
        store.run((draft) => { draft.rows[5].title = `title-${i + 1}`; });
        const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
        if (i >= 3) times.push(elapsed);
    }
    return {editMs: median(times), samples: times};
}

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify(await measure(process.env.BENCH_ROOT, Number(process.env.BENCH_ROWS))));
} else {
    if (!process.env.BASELINE_DIST) throw Error('Set BASELINE_DIST');
    const roots = {
        baseline: normalizeRoot(process.env.BASELINE_DIST),
        fixed: normalizeRoot(process.env.AFTER_DIST || 'dist'),
    };
    const results = {};
    const script = fileURLToPath(import.meta.url);
    for (const size of SIZES) {
        results[size] = {baseline: [], fixed: []};
        for (let round = 0; round < CHILDREN; round++) {
            const labels = round % 2 === 0 ? ['baseline', 'fixed'] : ['fixed', 'baseline'];
            for (const label of labels) {
                const child = spawnSync(process.execPath, [script], {
                    encoding: 'utf8',
                    env: {...process.env, BENCH_ROOT: roots[label], BENCH_ROWS: String(size)},
                });
                if (child.status !== 0) throw Error(child.stderr || String(child.error));
                results[size][label].push(JSON.parse(child.stdout).editMs);
            }
        }
    }
    for (const size of SIZES) {
        const baselineMs = median(results[size].baseline);
        const afterMs = median(results[size].fixed);
        console.log(JSON.stringify({
            rows: size,
            baselineRuns: results[size].baseline,
            afterRuns: results[size].fixed,
            baselineMedianMs: baselineMs,
            afterMedianMs: afterMs,
            gateMs: 2,
            pass: afterMs <= 2,
        }));
    }
}
