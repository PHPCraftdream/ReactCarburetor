/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sampleScenario, summarize, show} from '../harness/measure.mjs';
import {evaluate, compare} from '../harness/evaluate.mjs';

/** Checks every contract present in the baseline, retaining raw alternating samples and all timing flags. */
export const comparePrevious = (baseline, currentRoot, runs, output) => {
    for (const [file, expected] of Object.entries(baseline.gateHashes)) {
        const actual = createHash('sha256').update(readFileSync(resolve('perf/gates', file))).digest('hex');
        if (actual !== expected) throw new Error('Baseline gate contract changed: ' + file);
    }
    const byId = new Map(baseline.entries.map(entry => [entry.id, entry]));
    const ordered = [], placed = new Set(), visiting = new Set();
    const visit = entry => {
        if (!entry) throw new Error('Missing scale source');
        if (placed.has(entry.id)) return;
        if (visiting.has(entry.id)) throw new Error('Cyclic scale dependency: ' + entry.id);
        visiting.add(entry.id);
        for (const gate of entry.gates) if (gate.scale) visit(byId.get(gate.scale.from));
        visiting.delete(entry.id); placed.add(entry.id); ordered.push(entry);
    };
    baseline.entries.forEach(visit);
    const measured = new Map(), before = new Map(), after = new Map();
    const report = {baseline: baseline.sha, baselineEntries: baseline.entries.length, runs,
        originalGateFiles: Object.keys(baseline.gateHashes).length, currentRoot,
        baselineRoot: resolve(baseline.dist, 'esm-prod'), baselineGateFailures: 0,
        currentGateFailures: 0, timingFailures: 0, crashes: 0, rows: []};
    const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    save();
    for (const entry of ordered) {
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
    report.accepted = !report.baselineGateFailures && !report.currentGateFailures && !report.timingFailures && !report.crashes;
    save(); return report;
};
