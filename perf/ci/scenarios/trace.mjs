/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sampleScenario, summarize, show} from '../../harness/measure.mjs';
import {evaluate, compare} from '../../harness/evaluate.mjs';

/** Collects optimizer traces separately; traced durations never replace regression samples. */
export const collectTraces = (output, roots) => {
    const cases = [
        {id: 'key-memo', scenario: 'cache/key-memo', args: ['cycle', '4096'], flags: []},
        {id: 'diamond', scenario: 'computed/pg-c1/diamond-ladder', args: [], flags: []},
        {id: 'write-bytes', scenario: 'writelog39/write-bytes', args: ['6000', '--child'],
            flags: ['--min-semi-space-size=64', '--max-semi-space-size=64']},
    ];
    const rows = [];
    for (const [name, root] of Object.entries(roots)) {
        for (const {id, scenario, args, flags} of cases) {
            const argv = ['--expose-gc', '--trace-opt', '--trace-deopt', '--trace-gc', ...flags,
                resolve('perf/scenarios', scenario + '.mjs'), ...args];
            const result = spawnSync(process.execPath, argv, {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
                env: {...process.env, NODE_ENV: 'production', DIST_ROOT: root}});
            writeFileSync(resolve(output, `trace-${name}-${id}.out`), result.stdout ?? '');
            writeFileSync(resolve(output, `trace-${name}-${id}.err`), result.stderr ?? '');
            const marker = result.stdout?.indexOf('@@ ') ?? -1;
            const line = marker >= 0 ? result.stdout.slice(marker + 3).split('\n')[0] : undefined;
            rows.push({name, id, argv, root, status: result.status, error: result.error?.message,
                metrics: line ? JSON.parse(line) : null});
        }
    }
    return rows;
};

/** Confirms the last full sweep's alerts with independent matched-layout A/B and A/A. */
export const confirmTimingFlags = async (baseline, output) => {
    const current = resolve(baseline.currentDist, 'esm-prod');
    const sameA = resolve('worktrees/ci-aa-control/baseline');
    const sameB = resolve('worktrees/ci-aa-control/modified');
    cpSync(baseline.currentDist, sameA, {recursive: true});
    cpSync(baseline.currentDist, sameB, {recursive: true});
    const selected = new Set(['selection44/timing@M8-L64',
        'selection44/timing@M8-L65536', 'selection44/timing@M64-L65536']);
    const selection = (await import('../../gates/selection44.mjs')).default;
    const entries = [baseline.entries.find(entry => entry.id === 'writelog39/bound-write-hook@10000'),
        ...selection.filter(entry => selected.has(entry.id))];
    const report = {baseline: baseline.sha, current: process.env.GITHUB_SHA, runs: 9, rows: [],
        interpretation: 'Independent confirmation; original five alerts from run 38360790636 remain preserved.'};
    for (const entry of entries) {
        assert.ok(entry, 'registered confirmation entry');
        const adapted = entry.scenario === 'selection44/timing';
        const scenario = resolve(adapted ? 'perf/ci/scenarios/selection-timing.mjs'
            : 'perf/scenarios/' + entry.scenario + '.mjs');
        const samples = sampleScenario(scenario, entry.args, [
            {name: 'before', dir: resolve(baseline.dist, 'esm-prod')}, {name: 'after', dir: current},
            {name: 'sameA', dir: resolve(sameA, 'esm-prod')}, {name: 'sameB', dir: resolve(sameB, 'esm-prod')},
        ], 9, entry.nodeArgs ?? []);
        for (const [name, observations] of samples) for (const metrics of observations) {
            if (adapted) {
                assert.equal(metrics.controlsCorrect, true); assert.equal(metrics.uninstrumented, true);
                assert.equal(metrics.results.length, 24);
                const diagnostics = metrics.results.filter(result => result.diagnostic);
                assert.equal(diagnostics.length, 4);
                if (name === 'before') assert.ok(diagnostics.every(result =>
                    !result.correct && result.defect?.code === 'ERR_ASSERTION'));
                assert.ok(metrics.results.filter(result => !result.diagnostic).every(result => result.correct));
                if (name !== 'before') assert.ok(metrics.results.every(result => result.correct));
            } else assert.ok(evaluate(entry, summarize([metrics]), new Map()).every(result => result.ok));
        }
        const summaries = Object.fromEntries([...samples].map(([name, observations]) => [name, summarize(observations)]));
        const row = {id: entry.id, raw: Object.fromEntries(samples),
            summaries: Object.fromEntries(Object.entries(summaries).map(([name, metrics]) => [name,
                Object.fromEntries(Object.entries(metrics).filter(([metric]) => metric.endsWith('Ms'))
                    .map(([metric, value]) => [metric, show(value)]))])),
            ab: compare(entry, summaries.after, summaries.before),
            aa: compare(entry, summaries.sameB, summaries.sameA)};
        report.rows.push(row);
        writeFileSync(resolve(output, 'timing-confirmation.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(entry.id + ': ' + JSON.stringify({ab: row.ab.filter(result => !result.ok),
            aa: row.aa.filter(result => !result.ok)}));
    }
    report.completed = report.rows.length === entries.length;
    writeFileSync(resolve(output, 'timing-confirmation.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
};
