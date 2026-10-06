/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// The performance gate suite: every entry in perf/gates/*.mjs is measured on the build under test
// and checked against its gates. Exit code 1 on any violation, so it can guard a change.
//
//   npm run build && npm run bench
//   npm run bench -- --only history --runs 5
//   npm run bench -- --against <git-ref>     # also compare every timing with a build of <ref>
//   npm run bench -- --lint-gates            # static manifest checks, no scenario is run
//   npm run bench -- --list
//
// Options: --dist <dir> (default dist/esm-prod)  --only <substring of an entry id>  --runs <n> (default 3)
//          --against <ref>  --json <file>  --verbose
//
// A failing entry does not abort the run: a crashed scenario, a non-zero child or a missing metrics
// line is that entry's FAIL (counted as a violation) and the remaining entries still run. The same
// holds for a baseline build that lacks an API a scenario needs, so a whole --against sweep over
// old builds still ends with a per-entry summary. Entries sharing (scenario, args) are measured
// once per build and share their samples.
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
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

/** First `lines` non-empty lines of `text` joined with ' | ', cut to `limit` characters. */
const brief = (text, limit = 200, lines = 2) => {
    const flat = text.split('\n').map(line => line.trim()).filter(Boolean).slice(0, lines).join(' | ');
    return flat.length > limit ? flat.slice(0, limit - 3) + '...' : flat;
};

const entries = [];
for (const file of readdirSync(join(here, 'gates')).filter(name => name.endsWith('.mjs')).sort()) {
    const module = await import(pathToFileURL(join(here, 'gates', file)).href);
    entries.push(...module.default.map(entry => ({...entry, area: file.replace(/\.mjs$/, '')})));
}
const byId = new Map();
const duplicateIds = [];
for (const entry of entries) {
    if (byId.has(entry.id)) duplicateIds.push(entry.id);
    else byId.set(entry.id, entry);
}
if (duplicateIds.length > 0 && !argv.includes('--lint-gates')) {
    throw new Error('duplicate gate entry id ' + [...new Set(duplicateIds)].join(', '));
}

/**
 * Unions the metric names of every `emit({...})` in a scenario's source — a scenario may emit
 * different metric sets per argument branch. Null when any emit is not a plain object literal (a
 * variable, a spread): the metric check is then simply skipped for that file.
 */
const emittedMetrics = scenarioPath => {
    if (!existsSync(scenarioPath)) return null;
    const source = readFileSync(scenarioPath, 'utf8');
    const names = new Set();
    let sawEmit = false;
    let search = 0;
    while (search < source.length) {
        const call = source.indexOf('emit(', search);
        if (call === -1) break;
        search = call + 5;
        if (call > 0 && /[\w$]/.test(source[call - 1])) continue;
        let index = search;
        while (index < source.length && /\s/.test(source[index])) index++;
        if (source[index] !== '{') return null;
        sawEmit = true;
        let depth = 0;
        let quote = '';
        let chunk = '';
        let open = false;
        const flush = () => {
            const token = chunk.trim().split(':')[0].trim();
            if (!token.startsWith('.') && /^[A-Za-z_$][\w$]*$/.test(token)) names.add(token);
            else open = true;
            chunk = '';
        };
        for (; index < source.length; index++) {
            const char = source[index];
            if (quote) {
                if (char === '\\') index++;
                else if (char === quote) quote = '';
                continue;
            }
            if (char === '"' || char === "'" || char === '`') {quote = char; continue;}
            if ('{(['.includes(char)) {depth++; continue;}
            if ('})]'.includes(char)) {
                if (--depth === 0) break;
                continue;
            }
            if (depth === 1 && char === ',') flush();
            else if (depth >= 1) chunk += char;
        }
        if (depth !== 0) return null;
        flush();
        if (open) return null;
        search = index + 1;
    }
    return sawEmit ? names : null;
};

/** 'control', a round item (R34-03, R19-ENGINE-01, R6-02/03, R31-01+R31-05) or a commit sha. */
const isLabel = label => label === 'control' || /^[0-9a-f]{7,12}$/.test(label)
    || /^R\d+(?:[-/][A-Za-z0-9.]+)*(?:\+R\d+(?:[-/][A-Za-z0-9.]+)*)?$/.test(label);

if (argv.includes('--lint-gates')) {
    const problems = [];
    if (duplicateIds.length > 0) problems.push('duplicate entry id: ' + [...new Set(duplicateIds)].join(', '));
    for (const entry of entries) {
        const where = `${entry.id} [${entry.improvement}]`;
        if (!isLabel(entry.improvement)) {
            problems.push(`${where}: improvement "${entry.improvement}" is not R<n>-<nn>, 'control' or a commit sha`);
        }
        const scenarioPath = join(here, 'scenarios', entry.scenario + '.mjs');
        if (!existsSync(scenarioPath)) problems.push(`${where}: no scenario at perf/scenarios/${entry.scenario}.mjs`);
        const metrics = emittedMetrics(scenarioPath);
        const gates = Array.isArray(entry.gates) ? entry.gates : [];
        if (gates.length === 0) problems.push(`${where}: no gates`);
        gates.forEach((gate, position) => {
            const kind = gate && ['equals', 'scale', 'over', 'max', 'min'].find(key => key in gate);
            if (!gate || typeof gate.metric !== 'string' || !kind) {
                problems.push(`${where}: gate #${position + 1} ${JSON.stringify(gate)} needs a metric and one of equals/scale/over/max/min`);
                return;
            }
            if ((kind === 'max' || kind === 'min') && typeof gate[kind] !== 'number') {
                problems.push(`${where}: gate #${position + 1} ${kind} needs a numeric bound`);
            }
            if (kind === 'over') {
                if (typeof gate.over !== 'string') problems.push(`${where}: gate #${position + 1} over needs a metric name`);
                else if (metrics && !metrics.has(gate.over)) problems.push(`${where}: over metric "${gate.over}" is not emitted by the scenario`);
            }
            if (kind === 'scale' && !byId.has(gate.scale?.from)) {
                problems.push(`${where}: scale.from ${JSON.stringify(gate.scale?.from)} matches no entry id`);
            }
            if ((kind === 'over' || kind === 'scale') && typeof gate.max !== 'number') {
                problems.push(`${where}: gate #${position + 1} ${kind} needs a numeric max`);
            }
            if (metrics && !metrics.has(gate.metric)) {
                problems.push(`${where}: gate metric "${gate.metric}" is not emitted by perf/scenarios/${entry.scenario}.mjs`);
            }
        });
    }
    for (const problem of problems) console.log(problem);
    console.log(`\n${entries.length} entries, ${problems.length} lint problem${problems.length === 1 ? '' : 's'}`);
    process.exit(problems.length === 0 ? 0 : 1);
}

const only = option('only', '');
const matched = entries.filter(entry => entry.id.includes(only) || entry.area.includes(only));

if (argv.includes('--list')) {
    for (const entry of matched) {
        console.log(`${entry.id.padEnd(46)} ${entry.improvement.padEnd(10)} ${entry.gates.length} gates`);
    }
    process.exit(0);
}
if (only !== '' && matched.length === 0) {
    console.log(`--only "${only}" matched no entry id or area`);
    process.exit(1);
}

// scale.from sources are pulled in transitively, measured for their numbers, and never printed as
// selected entries; without them --only would fail every scale gate with "was not measured".
const order = [];
const placed = new Set();
const visiting = new Set();
const addWithSources = entry => {
    if (placed.has(entry.id) || visiting.has(entry.id)) return;
    visiting.add(entry.id);
    for (const gate of entry.gates ?? []) {
        if (gate?.scale && gate.scale.from !== entry.id && byId.has(gate.scale.from)) {
            addWithSources(byId.get(gate.scale.from));
        }
    }
    placed.add(entry.id);
    order.push(entry);
};
matched.forEach(addWithSources);
const hidden = new Set(order.filter(entry => !matched.includes(entry)).map(entry => entry.id));

const dist = resolve(option('dist', 'dist/esm-prod'));
if (!existsSync(join(dist, 'Carburetor', 'index.mjs'))) {
    throw new Error(`no build at ${dist}: run \`npm run build\` first (or pass --dist)`);
}
const against = option('against', undefined);
const roots = [{name: 'now', dir: dist}];
if (against) roots.push({name: 'base', dir: join(baselineDist(against), 'esm-prod')});
const runs = Number(option('runs', '3'));
const verbose = argv.includes('--verbose');

// One measurement per (scenario, args) per build, shared by every entry that uses it; a failed
// measurement is cached too, so each entry pointing at the same broken scenario fails with the
// same cause instead of re-running it.
const samplesByKey = new Map();
const samplesFor = entry => {
    const key = entry.scenario + ' ' + JSON.stringify(entry.args ?? []);
    if (!samplesByKey.has(key)) {
        try {
            samplesByKey.set(key, sampleScenario(join(here, 'scenarios', entry.scenario + '.mjs'), entry.args ?? [], roots, runs));
        } catch (error) {
            samplesByKey.set(key, error);
        }
    }
    const samples = samplesByKey.get(key);
    if (samples instanceof Error) throw samples;
    return samples;
};

const summaries = new Map();
const report = [];
let violations = 0;
let failedEntries = 0;
for (const entry of order) {
    let now, base, failure;
    try {
        const samples = samplesFor(entry);
        now = summarize(samples.get('now'));
        if (against) base = summarize(samples.get('base'));
    } catch (error) {
        failure = error;
    }
    if (now) summaries.set(entry.id, now);
    if (hidden.has(entry.id)) {
        if (failure) console.log(`note  ${entry.id} (scale source) could not be measured: ${brief(failure.message)}`);
        else if (verbose) console.log(`note  ${entry.id} measured as a scale source, not selected`);
        continue;
    }
    if (failure) {
        const detail = brief(failure.message);
        violations += 1;
        failedEntries += 1;
        console.log(`FAIL ${entry.id}  [${entry.improvement}]`);
        console.log(`       ✗ run: ${detail}`);
        if (verbose && failure.output) {
            console.log(`       ${brief(failure.output.stderr || failure.output.stdout || '', 2000, 30)}`);
        }
        report.push({id: entry.id, improvement: entry.improvement, error: detail, violations: ['run: ' + detail]});
        continue;
    }
    const results = evaluate(entry, now, summaries);
    if (against) results.push(...compare(entry, now, base));
    const bad = results.filter(result => !result.ok);
    violations += bad.length;
    if (bad.length > 0) failedEntries += 1;
    console.log(`${bad.length === 0 ? 'ok  ' : 'FAIL'} ${entry.id}  [${entry.improvement}]`);
    for (const result of results) {
        if (!result.ok || verbose) {
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
const sources = hidden.size === 0 ? '' : ` (+${hidden.size} scale source${hidden.size === 1 ? '' : 's'} measured)`;
console.log(`\n${matched.length} entries, ${failedEntries} failed, ${violations} violation${violations === 1 ? '' : 's'}${sources}`);
process.exit(violations === 0 ? 0 : 1);
