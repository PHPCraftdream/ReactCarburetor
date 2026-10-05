/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// The performance gate suite: every scenario in perf/gates/*.mjs is measured on the build under test
// and checked against its gates. Exit code 1 on any violation, so it can guard a change.
//
//   npm run build && npm run bench
//   npm run bench -- --only history --runs 5
//   npm run bench -- --against <git-ref>     # also compare every timing with a build of <ref>
//   npm run bench -- --list
//
// Options: --dist <dir> (default dist/esm-prod)  --only <substring of an entry id>  --runs <n> (default 3)
//          --against <ref>  --json <file>  --list
import {existsSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {baselineDist} from './harness/baseline.mjs';
import {compare, evaluate} from './harness/evaluate.mjs';
import {sampleScenario, show, summarize} from './harness/measure.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const option = (name, fallback) => {
    const index = argv.indexOf('--' + name);
    return index === -1 ? fallback : argv[index + 1];
};

const entries = [];
for (const file of readdirSync(join(here, 'gates')).filter(name => name.endsWith('.mjs')).sort()) {
    const module = await import(pathToFileURL(join(here, 'gates', file)).href);
    entries.push(...module.default.map(entry => ({...entry, area: file.replace(/\.mjs$/, '')})));
}
const ids = new Set();
for (const entry of entries) {
    if (ids.has(entry.id)) throw new Error('duplicate gate entry id ' + entry.id);
    ids.add(entry.id);
}

const only = option('only', '');
const selected = entries.filter(entry => entry.id.includes(only) || entry.area.includes(only));

if (argv.includes('--list')) {
    for (const entry of selected) {
        console.log(`${entry.id.padEnd(46)} ${entry.improvement.padEnd(10)} ${entry.gates.length} gates`);
    }
    process.exit(0);
}

const dist = resolve(option('dist', 'dist/esm-prod'));
if (!existsSync(join(dist, 'Carburetor', 'index.mjs'))) {
    throw new Error(`no build at ${dist}: run \`npm run build\` first (or pass --dist)`);
}
const against = option('against', undefined);
const roots = [{name: 'now', dir: dist}];
if (against) roots.push({name: 'base', dir: join(baselineDist(against), 'esm-prod')});
const runs = Number(option('runs', '3'));

const summaries = new Map();
const report = [];
let failed = 0;
for (const entry of selected) {
    const scenario = join(here, 'scenarios', entry.scenario + '.mjs');
    const samples = sampleScenario(scenario, entry.args ?? [], roots, runs);
    const now = summarize(samples.get('now'));
    summaries.set(entry.id, now);
    const results = evaluate(entry, now, summaries);
    if (against) results.push(...compare(entry, now, summarize(samples.get('base'))));
    const bad = results.filter(result => !result.ok);
    failed += bad.length;
    console.log(`${bad.length === 0 ? 'ok  ' : 'FAIL'} ${entry.id}  [${entry.improvement}]`);
    for (const result of results) {
        if (!result.ok || argv.includes('--verbose')) {
            console.log(`       ${result.ok ? ' ' : '✗'} ${result.label}: ${result.detail}`);
        }
    }
    report.push({
        id: entry.id, improvement: entry.improvement,
        metrics: Object.fromEntries(Object.keys(now).map(metric => [metric, show(now[metric])])),
        violations: bad.map(result => `${result.label}: ${result.detail}`),
    });
}

const json = option('json', undefined);
if (json) writeFileSync(json, JSON.stringify(report, null, 2));
console.log(`\n${selected.length} entries, ${failed} violation${failed === 1 ? '' : 's'}`);
process.exit(failed === 0 ? 0 : 1);
