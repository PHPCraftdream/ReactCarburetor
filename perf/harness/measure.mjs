/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Runs one scenario on one or more builds, one child process per sample, builds interleaved.
// A scenario is a module that reads its build from DIST_ROOT and ends with one `@@ {json}` line.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

/** The first line mentioning an error (a thrown message), else the first non-empty lines, kept short. */
const brief = (text, limit = 240) => {
    const lines = String(text).split('\n').map(line => line.trim()).filter(Boolean);
    const cause = lines.find(line => /\berror\b/i.test(line)) ?? lines.slice(0, 3).join(' | ');
    return (cause || 'no output').length > limit ? cause.slice(0, limit - 3) + '...' : cause;
};

/** Runs a scenario once on one build and returns its metrics object. */
export const runOnce = (scenario, args, distRoot) => {
    const child = spawnSync(process.execPath, ['--expose-gc', resolve(scenario), ...args.map(String)], {
        env: {...process.env, NODE_ENV: 'production', DIST_ROOT: resolve(distRoot)},
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (child.error) throw child.error;
    const line = child.stdout.split('\n').reverse().find(text => text.startsWith('@@ '));
    if (child.status !== 0 || !line) {
        // The full child output rides on error.output for the runner's verbose mode; the message stays one line.
        const error = new Error(`exited ${child.status}: ${brief(child.stderr || child.stdout || 'no output')}`);
        error.output = child;
        throw error;
    }

    return JSON.parse(line.slice(3));
};

/**
 * Samples a scenario `runs` times on every build, rotating which build goes first so a drift in
 * machine load spreads over all of them.
 *
 * @param scenario - path to the scenario module
 * @param args - the scenario's arguments
 * @param roots - [{name, dir}] builds to measure
 * @param runs - samples per build
 * @returns Map name -> array of metrics objects
 */
export const sampleScenario = (scenario, args, roots, runs) => {
    const samples = new Map(roots.map(root => [root.name, []]));
    for (let run = 0; run < runs; run++) {
        for (let offset = 0; offset < roots.length; offset++) {
            const root = roots[(run + offset) % roots.length];
            samples.get(root.name).push(runOnce(scenario, args, root.dir));
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
