/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {summarize} from '../harness/measure.mjs';
import {evaluate} from '../harness/evaluate.mjs';
import {baselineDist} from '../harness/baseline.mjs';

/** Rejects the pre-fix build on each intended mechanism, retaining positives and exact failure signatures. */
export const calibrateGains = async (baseline, output) => {
    const entries = [];
    for (const family of ['computed44', 'history44', 'selection44', 'components44', 'hooks44', 'resource44']) {
        entries.push(...(await import(pathToFileURL(resolve('perf/gates', family + '.mjs')).href)).default);
    }
    const metadataBaseline = process.env.BENCH_METADATA_BASELINE;
    const metadataDist = metadataBaseline ? baselineDist(metadataBaseline) : undefined;
    const cases = [
        {finding: 'R44-C01', id: 'computed44/repeated-flat-snapshot@K16-M16-aliases', metrics: ['keyCalls', 'keyEntries', 'leafUIDs']},
        {finding: 'R44-C02', id: 'computed44/observed-baseline-eligibility@M32-changed', metrics: ['preBodyCalls', 'preBodyEntries']},
        {finding: 'R44-C01-single-leaf', id: 'computed44/observed-baseline-eligibility@M1-changed',
            metrics: ['captureValueCalls', 'captureValueEntries'], beforeDist: metadataDist},
        {finding: 'R44-S02', id: 'history44/after-opaque@32-3-32-native-middle', metrics: ['afterOpaqueVisits', 'cutoverUnusedOwnedNodes', 'unusedOwnedNodes']},
        {finding: 'R44-S03', id: 'history44/scalar-proof@64-2-repeat-plain', metrics: ['undoWeakmaps', 'redoWeakmaps']},
        {finding: 'R44-R-01', id: 'resource44/controls', metrics: ['cowOwnershipAccepted', 'cancelledGenerationProtected']},
        {finding: 'R44-S01', id: 'selection44/array-spine-prototype@M8-L64', actual: /actual:\s*0\b/, expected: /expected:\s*1\b/},
        {finding: 'R44-A01', id: 'components44/selection-attribution-lifetime@4', actual: /actual:\s*4\b/, expected: /expected:\s*0\b/},
        {finding: 'R44-A02', id: 'hooks44/computed-snapshot-lifetime', expected: /expected:\s*undefined/, diagnostic: /strictEqual/},
        {finding: 'R44-R-02', id: 'resource44/ready-completion', actual: /actual:\s*8\b/, expected: /expected:\s*1\b/},
    ].filter(target => target.finding !== 'R44-C01-single-leaf' || metadataBaseline);
    const report = {baseline: baseline.sha, metadataBaseline, cases: cases.length,
        formats: ['esm-prod', 'esm', 'cjs-prod', 'cjs'], rows: [], skipped: 0, failures: 0};
    const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    save();
    for (const format of report.formats) for (const target of cases) for (const side of ['before', 'after']) {
        const entry = entries.find(entry => entry.id === target.id);
        assert.ok(entry, 'registered calibration entry ' + target.id);
        const missing = (entry.requires ?? []).filter(item => !existsSync(resolve(item.path))).map(item => item.path);
        if (missing.length) {report.rows.push({finding: target.finding, id: target.id, format, skipped: missing, classification: 'skipped-missing-requires', accepted: true}); report.skipped = (report.skipped ?? 0) + 1; continue;}
        const root = resolve(side === 'before' ? (target.beforeDist ?? baseline.dist) : baseline.currentDist, format);
        const argv = ['--expose-gc', resolve('perf/scenarios', entry.scenario + '.mjs'), ...(entry.args ?? []).map(String)];
        const env = {NODE_ENV: format.endsWith('-prod') ? 'production' : 'development', DIST_ROOT: root};
        const child = spawnSync(process.execPath, argv, {env: {...process.env, ...env}, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000});
        const row = {finding: target.finding, id: target.id, format, side, executable: process.execPath, argv, env,
            status: child.status, signal: child.signal, error: child.error?.message,
            stdout: child.stdout ?? '', stderr: child.stderr ?? ''};
        try {
            assert.equal(child.error, undefined); assert.equal(child.signal, null);
            const lines = row.stdout.split(/\r?\n/).filter(line => line.startsWith('@@ '));
            if (side === 'before' && !target.metrics) {
                assert.equal(child.status, 1); assert.equal(lines.length, 0);
                assert.match(row.stderr, /AssertionError \[ERR_ASSERTION\]/);
                if (target.actual) assert.match(row.stderr, target.actual);
                if (target.expected) assert.match(row.stderr, target.expected);
                if (target.diagnostic) assert.match(row.stderr, target.diagnostic);
                row.classification = 'exact-mechanism-negative';
            } else {
                assert.equal(child.status, 0); assert.equal(lines.length, 1);
                row.metrics = JSON.parse(lines[0].slice(3));
                row.gates = evaluate(entry, summarize([row.metrics]), new Map());
                const failed = entry.gates.filter((_gate, index) => !row.gates[index].ok).map(gate => gate.metric);
                if (side === 'after') {assert.deepEqual(failed, []); row.classification = 'all-gates-pass';}
                else {
                    assert.deepEqual([...new Set(failed)].sort((a, b) => a.localeCompare(b)),
                        [...target.metrics].sort((a, b) => a.localeCompare(b)));
                    assert.ok(entry.gates.every((gate, index) => target.metrics.includes(gate.metric) || row.gates[index].ok));
                    row.classification = 'exact-gain-failures-positive-controls-complete';
                }
            }
            row.accepted = true;
        } catch (error) {row.accepted = false; row.validationError = error.message; report.failures++;}
        report.rows.push(row); save(); console.log(target.finding + ' ' + format + ' ' + side + ': ' + (row.accepted ? row.classification : 'FAIL ' + row.validationError));
    }
    report.accepted = report.failures === 0; save(); return report;
};
