/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {prepareBaseline} from '../contract/baseline.mjs';
import {sampleScenario, summarize, show} from '../../harness/measure.mjs';
import {evaluate, compare} from '../../harness/evaluate.mjs';
import {collectTraces, confirmTimingFlags} from './trace.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Timing diagnostics run only on GitHub');
const baseline = await prepareBaseline('acfd3e2b8e58210ce1076bf1683f666283216af5');
const output = resolve('worktrees/ci-results', process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT);
mkdirSync(output, {recursive: true});
const current = resolve('dist/esm-prod');
const noResourceChanges = resolve('worktrees/ci-attribution-no-resource');
cpSync(current, noResourceChanges, {recursive: true});
cpSync(resolve(baseline.dist, 'esm-prod/Carburetor/Resource'), resolve(noResourceChanges, 'Carburetor/Resource'), {recursive: true});
cpSync(resolve(baseline.dist, 'esm-prod/Carburetor/Store/Diagnostics/Internal/ResourceSymbols.mjs'),
    resolve(noResourceChanges, 'Carburetor/Store/Diagnostics/Internal/ResourceSymbols.mjs'));
const lifecycleOnly = resolve('worktrees/ci-attribution-old-lifecycle');
const cacheOnly = resolve('worktrees/ci-attribution-old-cache');
const noComputedChanges = resolve('worktrees/ci-attribution-no-computed');
for (const [root, path] of [[lifecycleOnly, 'Carburetor/Resource/Cache/ResourceCacheLifecycle.mjs'],
    [cacheOnly, 'Carburetor/Resource/Cache/ResourceCache.mjs'], [noComputedChanges, 'Carburetor/Derived']]) {
    cpSync(current, root, {recursive: true});
    cpSync(resolve(baseline.dist, 'esm-prod', path), resolve(root, path), {recursive: true});
}
const relocatedBefore = resolve(baseline.dist, 'esm-prod');
const relocatedAfter = resolve(baseline.currentDist, 'esm-prod');
const modulePaths = ['Carburetor/Resource/Cache/ResourceCache.mjs',
    'Carburetor/Resource/Cache/ResourceCacheLifecycle.mjs', 'Carburetor/Derived/Computed.mjs',
    'Carburetor/Store/Diagnostics/Internal/ResourceSymbols.mjs'];
const modules = modulePaths.map(path => {
    const row = {path};
    for (const [name, root] of [['before', resolve(baseline.sourceDist, 'esm-prod')], ['after', current]]) {
        const bytes = readFileSync(resolve(root, path));
        row[name] = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
        const destination = resolve(output, 'modules', name, path);
        mkdirSync(resolve(destination, '..'), {recursive: true});
        writeFileSync(destination, bytes);
    }
    return row;
});
const ids = ['cache/key-memo@4096', 'cache/key-memo@8192-budget', 'cache/eviction-scaling@1k',
    'resource43/lookup-operations', 'computed/diamond-ladder@26', 'computed/hook-publication@100',
    'selection43/timing-dense@16', 'selection43/timing-dense@4096', 'history43/timing@32-32-one-update',
    'writelog39/write-bytes@6000'];
const report = {baseline: baseline.sha, current: process.env.GITHUB_SHA, runs: 9,
    roots: {before: resolve(baseline.sourceDist, 'esm-prod'), current, noResourceChanges,
        lifecycleOnly, cacheOnly, noComputedChanges, relocatedBefore, relocatedAfter}, modules, rows: [], failures: 0,
    interpretation: 'A/A uses byte-identical current distribution twice. Original gates and 25% + 0.05ms comparisons are retained; an A/A failure is uncertainty, not a code-regression waiver.'};
const save = () => writeFileSync(resolve(output, 'timing-diagnostics.json'), JSON.stringify(report, null, 2) + '\n');
save();
for (const id of ids) {
    const entry = baseline.entries.find(entry => entry.id === id);
    if (!entry) throw new Error('Missing diagnostic gate ' + id);
    try {
        const scenario = resolve('perf/scenarios', entry.scenario + '.mjs');
        const results = sampleScenario(scenario, entry.args ?? [], [{name: 'before', dir: report.roots.before},
            {name: 'after', dir: current}, {name: 'noResourceChanges', dir: noResourceChanges},
            {name: 'lifecycleOnly', dir: lifecycleOnly}, {name: 'cacheOnly', dir: cacheOnly},
            {name: 'noComputedChanges', dir: noComputedChanges},
            {name: 'relocatedBefore', dir: relocatedBefore}, {name: 'relocatedAfter', dir: relocatedAfter},
            {name: 'sameA', dir: current}, {name: 'sameB', dir: current}], 9, entry.nodeArgs ?? []);
        const summary = Object.fromEntries([...results].map(([name, samples]) => [name, summarize(samples)]));
        const row = {id, raw: Object.fromEntries(results), summaries: Object.fromEntries(Object.entries(summary)
            .map(([name, metrics]) => [name, Object.fromEntries(Object.entries(metrics).map(([metric, value]) => [metric, show(value)]))])),
            ab: compare(entry, summary.after, summary.before), aa: compare(entry, summary.sameB, summary.sameA),
            resourceCutover: compare(entry, summary.noResourceChanges, summary.before),
            cutovers: Object.fromEntries(['lifecycleOnly', 'cacheOnly', 'noComputedChanges']
                .map(name => [name, compare(entry, summary[name], summary.before)])),
            relocated: compare(entry, summary.relocatedAfter, summary.relocatedBefore),
            gates: Object.fromEntries(Object.entries(summary).map(([name, value]) => [name, evaluate(entry, value, new Map())]))};
        report.rows.push(row);
        console.log(id + ': ' + JSON.stringify({ab: row.ab.filter(result => !result.ok), aa: row.aa.filter(result => !result.ok),
            resourceCutover: row.resourceCutover.filter(result => !result.ok),
            cutovers: Object.fromEntries(Object.entries(row.cutovers)
                .map(([name, results]) => [name, results.filter(result => !result.ok)])),
            relocated: row.relocated.filter(result => !result.ok),
            gates: Object.fromEntries(Object.entries(row.gates).map(([name, rows]) => [name, rows.filter(result => !result.ok)]))}));
    } catch (error) {report.failures++; report.rows.push({id, error: error.message, output: error.output});}
    save();
}
report.traces = collectTraces(output, {before: report.roots.before, after: current});
report.failures += report.traces.filter(row => row.status !== 0 || row.error || !row.metrics).length;
report.confirmation = await confirmTimingFlags(baseline, output);
const classified = [...report.rows, ...(report.confirmation?.rows ?? [])].filter(row => row.ab || row.aa);
report.aaNoiseCeiling = Math.max(0, ...classified.flatMap(row => (row.aa ?? [])
    .map(result => Number(result.detail.match(/\(([\d.]+)x\)$/)?.[1] ?? 0))));
const abFlags = classified.flatMap(row => (row.ab ?? []).filter(result => !result.ok)
    .map(result => ({id: row.id, detail: result.detail,
        confirmed: Number(result.detail.match(/\(([\d.]+)x\)$/)?.[1] ?? 0) > report.aaNoiseCeiling})));
report.confirmedAlerts = abFlags.filter(flag => flag.confirmed).map(flag => flag.id + ' ' + flag.detail);
const aaFlags = classified.flatMap(row => (row.aa ?? []).filter(result => !result.ok)
    .map(result => ({id: row.id, detail: result.detail})));
report.interpretation = 'Byte-identical A/A on this runner already reaches up to ' + report.aaNoiseCeiling
    + 'x median ratio, so only A/B flags above that ceiling are confirmed regressions; everything else is informational.';
report.completed = report.rows.length === ids.length; save();
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (summaryPath) appendFileSync(summaryPath, '\n### Timing attribution (informational)\n\n'
    + `A/B flags: ${abFlags.length}, A/A flags (identical-build noise): ${aaFlags.length}, `
    + `A/A noise ceiling: ${report.aaNoiseCeiling}x, confirmed regressions: ${report.confirmedAlerts.length}.\n\n`
    + '| Alert | Detail |\n|---|---|\n'
    + abFlags.map(flag => `| ${flag.id}${flag.confirmed ? ' *' : ''} | ${flag.detail} |`).join('\n')
    + (aaFlags.length ? '\n\nA/A noise flags: ' + aaFlags.map(flag => flag.id + ' ' + flag.detail).join('; ') : '')
    + '\n');
process.exitCode = report.failures || !report.completed || report.confirmedAlerts.length ? 1 : 0;
