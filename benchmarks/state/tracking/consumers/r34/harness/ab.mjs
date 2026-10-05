/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// A/B runner: alternates one child process per sample between builds and aggregates the
// scenario's `@@ {json}` metrics. Counters that agree across samples print exactly; timings print
// as median [min–max], since separate processes on a shared machine disagree.
//
//   node ab.mjs <scenario.mjs> --roots base=dist/esm-prod,fix=path/to/esm-prod [--runs 5] [-- args]
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const own = dash === -1 ? argv : argv.slice(0, dash);
const passThrough = dash === -1 ? [] : argv.slice(dash + 1);
const scenario = own[0];
const option = (name, fallback) => {
    const index = own.indexOf('--' + name);
    return index === -1 ? fallback : own[index + 1];
};
const roots = option('roots', 'current=dist/esm-prod').split(',').map(pair => {
    const [name, dir] = pair.split('=');
    return {name, dir: resolve(dir)};
});
const runs = Number(option('runs', '5'));
if (!scenario) throw new Error('usage: node ab.mjs <scenario.mjs> --roots a=dir,b=dir [--runs n] [-- args]');

const samples = new Map(roots.map(root => [root.name, []]));
for (let run = 0; run < runs; run++) {
    // Interleaved, rotating the starting build so drift in machine load spreads over all of them.
    for (let offset = 0; offset < roots.length; offset++) {
        const root = roots[(run + offset) % roots.length];
        const child = spawnSync(process.execPath, ['--expose-gc', resolve(scenario), ...passThrough], {
            env: {...process.env, NODE_ENV: 'production', DIST_ROOT: root.dir},
            encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        });
        const line = child.stdout.split('\n').reverse().find(text => text.startsWith('@@ '));
        if (child.status !== 0 || !line) {
            throw new Error(`${root.name} run ${run} failed (${child.status}):\n${child.stdout}\n${child.stderr}`);
        }
        samples.get(root.name).push(JSON.parse(line.slice(3)));
    }
}

const format = values => {
    const exact = values.every(value => value === values[0]);
    if (exact && !(typeof values[0] === 'number' && !Number.isInteger(values[0]))) return String(values[0]);
    if (values.some(value => typeof value !== 'number')) return values.join(' / ');
    const sorted = [...values].sort((a, b) => a - b);
    const digits = sorted[sorted.length >> 1] < 1 ? 4 : 2;
    const middle = sorted[sorted.length >> 1].toFixed(digits);
    return exact ? middle : `${middle} [${sorted[0].toFixed(digits)}–${sorted[sorted.length - 1].toFixed(digits)}]`;
};
const metrics = [...new Set([...samples.values()].flatMap(list => list.flatMap(Object.keys)))];
const report = {scenario, args: passThrough, runs, results: {}};
for (const {name} of roots) {
    report.results[name] = Object.fromEntries(metrics.map(metric =>
        [metric, format(samples.get(name).map(sample => sample[metric]))]));
}
console.log(JSON.stringify(report, null, 2));
