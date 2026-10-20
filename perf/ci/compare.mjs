/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import {appendFileSync, existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sampleScenario, summarize, show} from '../harness/measure.mjs';
import {evaluate, compare} from '../harness/evaluate.mjs';
import {classifyBaselineGate} from './contract/gateContract.mjs';

/** Appends an informational GITHUB_STEP_SUMMARY section listing every timing flag. */
export const timingSummary = (title, rows) => {
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (!summary) return;
    const lines = rows.map(row => (row.timings ?? row.comparisons ?? []).filter(result => !result.ok)
        .map(result => `| ${row.id} | ${result.label} | ${result.detail} |`)).flat();
    appendFileSync(summary, `\n### ${title}\n\n` + (lines.length
        ? '| Entry | Metric | Baseline -> current |\n|---|---|---|\n' + lines.join('\n') + '\n'
        : 'No timing flags.\n'));
};

/** Checks every contract present in the baseline, retaining raw alternating samples and all timing flags. */
export const comparePrevious = async (baseline, currentRoot, runs, output) => {
    const amendments = JSON.parse(readFileSync(resolve('perf/ci/contract/gate-amendments.json'), 'utf8'));
    const amendedGateFiles = [];
    for (const [file, expected] of Object.entries(baseline.gateHashes)) {
        const manifest = (await import(pathToFileURL(resolve('perf/gates', file)).href)).default;
        if (!Array.isArray(manifest)) throw new Error('Invalid gate manifest: ' + file);
        const decision = classifyBaselineGate({file, expectedHash: expected, baselineManifest: baseline.gateManifests?.[file],
            manifest, amendmentHash: amendments[file]?.sha256});
        if (decision.error) throw new Error(decision.error);
        if (decision.amended || decision.tightened)
            amendedGateFiles.push({file, reason: decision.tightened ? 'tightened bounds without amendment' : amendments[file].reason});
    }
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary && amendedGateFiles.length) appendFileSync(summary, '\n### Amended baseline gates\n\n' + amendedGateFiles.map(row => `- ${row.file}: ${row.reason}`).join('\n') + '\n');
    let entries = baseline.entries;
    for (const {file} of amendedGateFiles) {
        const area = file.slice(0, -4);
        const current = (await import(pathToFileURL(resolve('perf/gates', file)).href)).default
            .map(entry => ({...entry, area}));
        const known = baseline.entries.filter(entry => entry.area === area).map(entry => entry.id).sort();
        const fresh = current.map(entry => entry.id).sort();
        if (JSON.stringify(known) !== JSON.stringify(fresh)) throw new Error('Amended gate entry IDs diverge from baseline: ' + file);
        entries = [...entries.filter(entry => entry.area !== area), ...current];
    }
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const ordered = [], placed = new Set(), visiting = new Set(), skippedIds = new Set();
    const visit = entry => {
        if (!entry) throw new Error('Missing scale source');
        if (placed.has(entry.id)) return;
        if (visiting.has(entry.id)) throw new Error('Cyclic scale dependency: ' + entry.id);
        visiting.add(entry.id);
        for (const gate of entry.gates) if (gate.scale) visit(byId.get(gate.scale.from));
        visiting.delete(entry.id); placed.add(entry.id); ordered.push(entry);
    };
    entries.forEach(visit);
    const measured = new Map(), before = new Map(), after = new Map();
    const report = {baseline: baseline.sha, baselineEntries: entries.length, runs,
        originalGateFiles: Object.keys(baseline.gateHashes).length, amendedGateFiles, skippedEntries: [], currentRoot,
        baselineRoot: resolve(baseline.dist, 'esm-prod'), baselineGateFailures: 0,
        currentGateFailures: 0, timingFailures: 0, crashes: 0, timingInformational: true, rows: []};
    const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    save();
    for (const entry of ordered) {
        const missing = (entry.requires ?? []).filter(item => !existsSync(resolve(item.path))).map(item => item.path);
        if (missing.length || entry.gates.some(gate => gate.scale && skippedIds.has(gate.scale.from))) {
            report.skippedEntries.push({id: entry.id, missing});
            skippedIds.add(entry.id); console.log('skip ' + entry.id + (missing.length ? ' (missing ' + missing.join(', ') + ')' : ' (scale source skipped)'));
            continue;
        }
        const key = JSON.stringify([entry.scenario, entry.args ?? [], entry.nodeArgs ?? []]);
        try {
            if (!measured.has(key)) {
                try {
                    measured.set(key, sampleScenario(resolve('perf/scenarios', entry.scenario + '.mjs'), entry.args ?? [],
                        [{name: 'before', dir: report.baselineRoot}, {name: 'after', dir: currentRoot}], runs, entry.nodeArgs ?? []));
                } catch (error) {measured.set(key, error);}
            }
            const samples = measured.get(key);
            if (samples instanceof Error) throw samples;
            const base = summarize(samples.get('before')), fixed = summarize(samples.get('after'));
            before.set(entry.id, base); after.set(entry.id, fixed);
            const beforeGates = evaluate(entry, base, before), afterGates = evaluate(entry, fixed, after);
            const timings = compare(entry, fixed, base);
            report.baselineGateFailures += beforeGates.filter(result => !result.ok).length;
            report.currentGateFailures += afterGates.filter(result => !result.ok).length;
            report.timingFailures += timings.filter(result => !result.ok).length;
            report.rows.push({id: entry.id, beforeGates, afterGates, timings,
                before: Object.fromEntries(Object.entries(base).map(([key, value]) => [key, show(value)])),
                after: Object.fromEntries(Object.entries(fixed).map(([key, value]) => [key, show(value)])),
                rawBefore: samples.get('before'), rawAfter: samples.get('after')});
            console.log(entry.id + ': ' + JSON.stringify({before: beforeGates.filter(result => !result.ok),
                after: afterGates.filter(result => !result.ok), timings: timings.filter(result => !result.ok)}));
        } catch (error) {
            report.crashes++; report.rows.push({id: entry.id, error: error.message, output: error.output});
            console.log('FAIL ' + entry.id + ': ' + error.message);
        }
        save();
    }
    report.accepted = !report.baselineGateFailures && !report.currentGateFailures && !report.crashes;
    save(); timingSummary('Baseline/fix timing comparison (informational)', report.rows); return report;
};
