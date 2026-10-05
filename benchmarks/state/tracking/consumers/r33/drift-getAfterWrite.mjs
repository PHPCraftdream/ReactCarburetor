import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {existsSync, mkdirSync, rmSync} from 'node:fs';

const ROWS = 10000;
const CHILDREN = 5;
const require = createRequire(import.meta.url);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const script = fileURLToPath(import.meta.url);

/** Measures repeated reads after unrelated writes in one isolated process.
 *
 * @param root - production distribution root
 */
const measure = async root => {
    const {Carburetor} = await import(pathToFileURL(resolve(root, 'Carburetor/Store/Carburetor.mjs')).href);
    const {computed} = await import(pathToFileURL(resolve(root, 'Carburetor/Derived/computedFactory.mjs')).href);
    class BenchStore extends Carburetor {
        /** Runs one update for the benchmark. */
        run(fn) { this.update(fn); }
    }
    const items = Array.from({length: ROWS}, (_, index) => ({done: index % 2 === 0}));
    const store = new BenchStore({items, draft: ''});
    let recomputes = 0;
    const open = computed(read => {
        recomputes++;
        let count = 0;
        for (const item of read(store).items) if (!item.done) count++;
        return count;
    });
    const id = open.subscribe(() => undefined);
    if (open.get() !== Math.floor(ROWS / 2)) throw new Error('unexpected initial count');
    const samples = [];
    for (let i = 0; i < 400; i++) {
        store.run(draft => { draft.draft = `x${i}`; });
        const start = process.hrtime.bigint();
        open.get();
        samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    if (recomputes !== 1) throw new Error(`expected 0 recomputations after initial, got ${recomputes - 1}`);
    open.unsubscribe(id);
    return {getMs: median(samples), recomputes};
};

if (process.env.BENCH_ROOT) {
    console.log(JSON.stringify(await measure(process.env.BENCH_ROOT)));
} else {
    const ownDist = resolve('dist/r33-benchmark');
    if (!process.env.BASELINE_DIST) {
        if (existsSync(ownDist)) throw new Error(`Refusing to overwrite existing ${ownDist}`);
        mkdirSync(ownDist, {recursive: true});
        try {
            const rslibCli = resolve(require.resolve('@rslib/core/package.json').replace(/package\.json$/, 'bin/rslib.js'));
            const build = spawnSync(process.execPath, [rslibCli, 'build'], {
                encoding: 'utf8', env: {...process.env, RSLIB_OUTPUT_DIR: ownDist},
            });
            if (build.status !== 0) throw new Error(build.stderr || build.stdout || build.error);
            const ownProd = resolve('dist/esm-prod');
            if (!existsSync(resolve(ownProd, 'Carburetor/Store/Carburetor.mjs')))
                throw new Error(`Missing built production distribution at ${ownProd}; run npm run build first`);
            const baseline = process.env.BASELINE_DIST ? resolve(process.env.BASELINE_DIST) : ownProd;
            const after = process.env.AFTER_DIST ? resolve(process.env.AFTER_DIST) : ownProd;
            const child = spawnSync(process.execPath, [script], {
                encoding: 'utf8', env: {...process.env, BASELINE_DIST: baseline, AFTER_DIST: after},
            });
            process.stdout.write(child.stdout);
            process.stderr.write(child.stderr);
            if (child.status !== 0) process.exitCode = child.status ?? 1;
        } finally {
            rmSync(ownDist, {recursive: true, force: true});
        }
        process.exit();
    }
    const roots = {baseline: process.env.BASELINE_DIST, after: process.env.AFTER_DIST ?? 'dist/esm-prod'};
    const results = {baseline: [], after: []};
    for (let round = 0; round < CHILDREN; round++) {
        for (const side of round % 2 === 0 ? ['baseline', 'after'] : ['after', 'baseline']) {
            const child = spawnSync(process.execPath, [script], {
                encoding: 'utf8', env: {...process.env, BENCH_ROOT: resolve(roots[side])},
            });
            if (child.status !== 0) throw new Error(`${side} child failed: ${child.stderr || child.error}`);
            results[side].push(JSON.parse(child.stdout));
        }
    }
    const summary = Object.fromEntries(Object.entries(results).map(([side, samples]) => [side, {
        getMs: median(samples.map(sample => sample.getMs)),
        recomputes: median(samples.map(sample => sample.recomputes - 1)),
    }]));
    const passTime = summary.after.getMs <= 0.05;
    const passRuns = summary.after.recomputes === 0;
    console.log(JSON.stringify({summary, gates: {
        getMs: {value: summary.after.getMs, limit: 0.05, pass: passTime},
        recomputes: {value: summary.after.recomputes, limit: 0, pass: passRuns},
    }}, null, 2));
    if (!passTime || !passRuns) process.exitCode = 1;
}
