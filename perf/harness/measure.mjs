/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Runs one scenario on one or more builds, one child process per sample, builds interleaved.
// A scenario is a module that reads its build from DIST_ROOT and ends with one `@@ {json}` line.
import {spawn, spawnSync} from 'node:child_process';
import {availableParallelism} from 'node:os';
import {resolve} from 'node:path';

/** The first line mentioning an error (a thrown message), else the first non-empty lines, kept short. */
const brief = (text, limit = 240) => {
    const lines = String(text).split('\n').map(line => line.trim()).filter(Boolean);
    const cause = lines.find(line => /\berror\b/i.test(line)) ?? lines.slice(0, 3).join(' | ');
    return (cause || 'no output').length > limit ? cause.slice(0, limit - 3) + '...' : cause;
};

const childArgs = (scenario, args, nodeArgs) => ['--expose-gc', ...nodeArgs, resolve(scenario), ...args.map(String)];
const childEnv = distRoot => ({...process.env, NODE_ENV: 'production', DIST_ROOT: resolve(distRoot)});

/** The metrics of a finished child, or the error that explains why there are none. */
const metricsOf = child => {
    const line = child.stdout.split('\n').reverse().find(text => text.startsWith('@@ '));
    if (child.status !== 0 || !line) {
        // The full child output rides on error.output for the runner's verbose mode; the message stays one line.
        const error = new Error(`exited ${child.status}: ${brief(child.stderr || child.stdout || 'no output')}`);
        error.output = child;
        throw error;
    }

    return JSON.parse(line.slice(3));
};

/** Runs a scenario once on one build and returns its metrics object. */
export const runOnce = (scenario, args, distRoot, nodeArgs = []) => {
    const child = spawnSync(process.execPath, childArgs(scenario, args, nodeArgs), {
        env: childEnv(distRoot), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.error) throw child.error;

    return metricsOf(child);
};

/** {@link runOnce} without blocking, so several children can run at once. */
const runOnceAsync = (scenario, args, distRoot, nodeArgs = []) => new Promise((settle, reject) => {
    const child = spawn(process.execPath, childArgs(scenario, args, nodeArgs), {env: childEnv(distRoot)});
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', status => {
        try {
            settle(metricsOf({status, stdout, stderr}));
        } catch (error) {
            reject(error);
        }
    });
});

/** How many children run at once: `BENCH_JOBS`, else one fewer than the cores, at least one. */
export const benchJobs = () => {
    const jobs = Number(process.env.BENCH_JOBS);
    return Number.isInteger(jobs) && jobs > 0 ? jobs : Math.max(1, availableParallelism() - 1);
};

/**
 * Samples many scenarios at once, `concurrency` children at a time. Only for scenarios whose
 * verdict does not depend on wall-clock time: a child's counters, heap and GC are its own, while
 * its timings would feel the neighbours.
 *
 * @param jobs - [{key, scenario, args, roots, runs, nodeArgs}]
 * @param concurrency - children running at once
 * @returns Map key -> (Map root name -> metrics array, as {@link sampleScenario} returns), or the
 *     first error one of the key's children ended with
 */
export const sampleConcurrently = async (jobs, concurrency = benchJobs()) => {
    const results = new Map();
    const tasks = [];
    for (const job of jobs) {
        const samples = new Map(job.roots.map(root => [root.name, Array.from({length: job.runs})]));
        results.set(job.key, samples);
        for (let run = 0; run < job.runs; run++) for (const root of job.roots) tasks.push({job, root, run, samples});
    }
    let next = 0;
    const worker = async () => {
        while (next < tasks.length) {
            const {job, root, run, samples} = tasks[next++];
            if (results.get(job.key) instanceof Error) continue;
            try {
                samples.get(root.name)[run] = await runOnceAsync(job.scenario, job.args, root.dir, job.nodeArgs);
            } catch (error) {
                results.set(job.key, error);
            }
        }
    };
    await Promise.all(Array.from({length: Math.min(concurrency, tasks.length)}, worker));

    return results;
};

/**
 * Samples a scenario `runs` times on every build, rotating which build goes first so a drift in
 * machine load spreads over all of them.
 *
 * @param scenario - path to the scenario module
 * @param args - the scenario's arguments
 * @param roots - [{name, dir}] builds to measure
 * @param runs - samples per build
 * @param nodeArgs - optional Node flags for each child
 * @returns Map name -> array of metrics objects
 */
export const sampleScenario = (scenario, args, roots, runs, nodeArgs = []) => {
    const samples = new Map(roots.map(root => [root.name, []]));
    for (let run = 0; run < runs; run++) {
        for (let offset = 0; offset < roots.length; offset++) {
            const root = roots[(run + offset) % roots.length];
            samples.get(root.name).push(runOnce(scenario, args, root.dir, nodeArgs));
        }
    }

    return samples;
};

/** Collapses samples to {metric: {values, median, min, max, exact}}; counters stay exact. */
export const summarize = list => {
    const out = {};
    for (const metric of new Set(list.flatMap(Object.keys))) {
        const values = list.map(sample => sample[metric]);
        const numbers = values.every(value => typeof value === 'number');
        const sorted = numbers ? [...values].sort((a, b) => a - b) : values;
        out[metric] = {
            values,
            exact: values.every(value => value === values[0]),
            median: numbers ? sorted[sorted.length >> 1] : values[0],
            min: numbers ? sorted[0] : values[0],
            max: numbers ? sorted[sorted.length - 1] : values[0],
        };
    }

    return out;
};

/** Human format of one summarized metric. */
export const show = item => {
    const {median, min, max, exact, values} = item;
    if (typeof median !== 'number') return String(values.every(value => value === values[0]) ? values[0] : values.join(' / '));
    const digits = Math.abs(median) < 1 ? 4 : 2;
    return exact && Number.isInteger(median) ? String(median)
        : `${median.toFixed(digits)} [${min.toFixed(digits)}–${max.toFixed(digits)}]`;
};
