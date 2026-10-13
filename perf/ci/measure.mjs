/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {summarize, show} from '../harness/measure.mjs';
import {evaluate, compare} from '../harness/evaluate.mjs';
import {timingSummary} from './compare.mjs';

/** Measures new completed-operation controls separately from mechanism counters, with alternating native children. */
export const measureControls = async (baseline, gateFiles, runs, output) => {
    const scenarios = new Set(['computed44/repeated-flat-timing', 'computed44/observed-baseline-timing',
        'history44/timing', 'selection44/timing', 'components44/render-commit',
        'hooks44/multi-consumer', 'resource44/completed-operations']);
    const entries = [];
    for (const file of gateFiles) {
        const gates = (await import(pathToFileURL(resolve('perf/gates', file)).href)).default;
        entries.push(...gates.filter(entry => scenarios.has(entry.scenario)));
    }
    const raw = output.replace(/\.json$/, '.jsonl');
    const roots = {before: resolve(baseline.dist, 'esm-prod'), after: resolve(baseline.currentDist, 'esm-prod')};
    const report = {baseline: baseline.sha, roots, runs, entries: entries.length,
        ordering: 'alternating AB / BA', completed: 0, crashes: 0, gateFailures: 0,
        timingFailures: 0, rows: [], raw, started: new Date().toISOString(),
        environment: {node: process.version, platform: process.platform, architecture: process.arch,
            runner: process.env.RUNNER_NAME, commit: process.env.GITHUB_SHA},
        limitations: ['Whole-operation production ESM controls only; no bytes, instructions, zero-GC or browser FPS inference.',
            'Unsupported baseline array graph lanes are separate untimed diagnostics, never correct speedup measurements.',
            'Comparison stays 25 percent plus 0.05ms; flags and raw samples are retained, but timing-only flags are informational: identical-build A/A (GitHub run 38380384986) already reaches 1.85x median ratio.']};
    const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    save();
    for (const entry of entries) {
        const source = entry.scenario === 'selection44/timing' ? 'perf/ci/scenarios/selection-timing.mjs'
            : entry.scenario === 'history44/timing' ? 'perf/ci/scenarios/history-timing.mjs'
                : 'perf/scenarios/' + entry.scenario + '.mjs';
        const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex');
        const samples = {before: [], after: []};
        const row = {id: entry.id, scenario: entry.scenario, source, sourceHash, samples, errors: []};
        for (let pair = 0; pair < runs; pair++) for (const side of pair % 2 ? ['after', 'before'] : ['before', 'after']) {
            const args = [resolve(source), ...(entry.args ?? []).map(String)];
            const env = {NODE_ENV: 'production', DIST_ROOT: roots[side]};
            const child = spawnSync(process.execPath, args, {env: {...process.env, ...env}, encoding: 'utf8',
                maxBuffer: 64 * 1024 * 1024, timeout: 240000});
            const observation = {id: entry.id, pair, side, executable: process.execPath, argv: args, env,
                sourceHash, status: child.status, signal: child.signal, error: child.error?.message,
                stdout: child.stdout ?? '', stderr: child.stderr ?? ''};
            try {
                assert.equal(child.status, 0, entry.id + ': ' + observation.stderr);
                assert.equal(child.signal, null); assert.equal(child.error, undefined);
                const lines = observation.stdout.split(/\r?\n/).filter(line => line.startsWith('@@ '));
                assert.equal(lines.length, 1, 'one final metrics record');
                const metrics = JSON.parse(lines[0].slice(3)); observation.metrics = metrics;
                if (entry.scenario === 'selection44/timing') {
                    assert.equal(metrics.controlsCorrect, true); assert.equal(metrics.uninstrumented, true);
                    assert.equal(metrics.results.length, 24);
                    const diagnostic = metrics.results.filter(result => result.diagnostic);
                    assert.equal(diagnostic.length, 4);
                    if (side === 'after') assert.ok(metrics.results.every(result => result.correct));
                    else assert.ok(diagnostic.every(result => !result.correct && result.defect?.code === 'ERR_ASSERTION'));
                    assert.ok(metrics.results.filter(result => !result.diagnostic).every(result => result.correct));
                } else {
                    const results = evaluate(entry, summarize([metrics]), new Map());
                    assert.ok(results.every(result => result.ok), JSON.stringify(results.filter(result => !result.ok)));
                    if (entry.scenario === 'history44/timing') {
                        assert.equal(metrics.wholeEndpointsCorrect, true); assert.equal(metrics.publicationCorrect, true);
                    }
                }
                for (const [metric, value] of Object.entries(metrics)) if (metric.endsWith('Ms')) {
                    assert.ok(Number.isFinite(value) && value >= 0, 'finite timing ' + metric);
                }
                samples[side].push(metrics); observation.accepted = true;
            } catch (error) {
                report.crashes++; observation.accepted = false; observation.validationError = error.message;
                row.errors.push({pair, side, message: error.message});
            }
            appendFileSync(raw, JSON.stringify(observation) + '\n', {flush: true});
        }
        assert.equal(createHash('sha256').update(readFileSync(source)).digest('hex'), sourceHash,
            'scenario mutated during A/B measurement');
        if (samples.before.length === runs && samples.after.length === runs) {
            const base = summarize(samples.before), fixed = summarize(samples.after);
            const timings = summary => Object.fromEntries(Object.keys(summary).filter(key => key.endsWith('Ms'))
                .map(key => [key, show(summary[key])]));
            row.before = timings(base); row.after = timings(fixed); row.comparisons = compare(entry, fixed, base);
            report.timingFailures += row.comparisons.filter(result => !result.ok).length;
            if (entry.scenario !== 'selection44/timing') {
                row.beforeGates = evaluate(entry, base, new Map()); row.afterGates = evaluate(entry, fixed, new Map());
                report.gateFailures += [...row.beforeGates, ...row.afterGates].filter(result => !result.ok).length;
            }
        }
        report.rows.push(row); report.completed++; save();
        console.log(entry.id + ': ' + JSON.stringify({errors: row.errors,
            timingFlags: row.comparisons?.filter(result => !result.ok)}));
    }
    report.finished = new Date().toISOString();
    timingSummary('Completed-operation timing flags (informational)', report.rows);
    report.accepted = report.completed === report.entries && !report.crashes && !report.gateFailures;
    save(); return report;
};
