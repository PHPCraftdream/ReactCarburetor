/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Ad-hoc A/B of one scenario across builds (no gates): exact counters, timings as median [min–max].
//
//   node perf/harness/ab.mjs <scenario.mjs> --roots base=dist-a/esm-prod,fix=dist/esm-prod [--runs 5] [-- args]
import {resolve} from 'node:path';
import {sampleScenario, show, summarize} from './measure.mjs';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const own = dash === -1 ? argv : argv.slice(0, dash);
const passThrough = dash === -1 ? [] : argv.slice(dash + 1);
const scenario = own[0];
const option = (name, fallback) => {
    const index = own.indexOf('--' + name);
    return index === -1 ? fallback : own[index + 1];
};
if (!scenario) throw new Error('usage: node perf/harness/ab.mjs <scenario.mjs> --roots a=dir,b=dir [--runs n] [-- args]');

const roots = option('roots', 'current=dist/esm-prod').split(',').map(pair => {
    const [name, dir] = pair.split('=');
    return {name, dir: resolve(dir)};
});
const samples = sampleScenario(scenario, passThrough, roots, Number(option('runs', '5')));
const report = {scenario, args: passThrough, results: {}};
for (const {name} of roots) {
    const summary = summarize(samples.get(name));
    report.results[name] = Object.fromEntries(Object.keys(summary).map(metric => [metric, show(summary[metric])]));
}
console.log(JSON.stringify(report, null, 2));
