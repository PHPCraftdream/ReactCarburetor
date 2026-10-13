/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import {spawnSync, execFileSync} from 'node:child_process';
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareBaseline} from './contract/baseline.mjs';
import {gateContractStatus} from './contract/gateContract.mjs';
import {hashGate} from './contract/hashGate.mjs';
import {comparePrevious} from './compare.mjs';
import {measureControls} from './measure.mjs';
import {calibrateGains} from './calibrate.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('This runner is GitHub-only; dispatch Performance validation instead of running locally.');
const args = process.argv.slice(2);
const option = (name, fallback) => {const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1];};
const phase = option('phase', 'current');
const reference = option('baseline', 'acfd3e2b8e58210ce1076bf1683f666283216af5');
const runs = Number(option('runs', '3'));
if (!['current', 'previous', 'controls', 'gains'].includes(phase)) throw new Error('Expected --phase current, previous, controls or gains');
if (!Number.isInteger(runs) || runs < 3) throw new Error('At least three independent samples are required');
const npm = process.env.npm_execpath;
if (!npm || !existsSync(npm)) throw new Error('Invoke through npm run bench:ci so the installed npm CLI is explicit');
const output = resolve('worktrees/ci-results', process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT);
mkdirSync(output, {recursive: true});
const commands = [];
function command(label, argv, options = {}) {
    console.log('CI COMMAND ' + label);
    const child = spawnSync(process.execPath, argv, {encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, ...options});
    const row = {label, executable: process.execPath, argv, cwd: options.cwd ?? process.cwd(),
        status: child.status, signal: child.signal, error: child.error?.message,
        stdout: child.stdout ?? '', stderr: child.stderr ?? ''};
    commands.push(row); writeFileSync(resolve(output, phase + '-commands.json'), JSON.stringify(commands, null, 2) + '\n');
    console.log(row.stdout); console.error(row.stderr);
    if (child.status !== 0 || child.error || child.signal) throw new Error(label + ' failed: ' + child.status);
}

const react = JSON.parse(readFileSync(resolve('node_modules/react/package.json'), 'utf8')).version;
const other = react.startsWith('18.') ? '19' : '18';
const versions = other === '18' ? ['react@18.3.1', 'react-dom@18.3.1'] : ['react@19.3.0', 'react-dom@19.3.0'];
const peer = resolve('.consumer-matrix', 'react' + other + '-npm');
if (!existsSync(resolve(peer, 'node_modules/react/package.json'))) {
    mkdirSync(peer, {recursive: true});
    writeFileSync(resolve(peer, 'package.json'), JSON.stringify({name: 'carburetor-ci-peer', private: true}) + '\n');
    command('prepare-other-supported-React-major', [npm, 'install', '--no-save', '--ignore-scripts', '--package-lock=false',
        '--no-audit', '--no-fund', ...versions], {cwd: peer});
}
const sha = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', reference + '^{commit}'], {encoding: 'utf8'}).trim();
const manifestPath = resolve(output, 'baseline.json');
let baseline = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
if (!baseline || baseline.sha !== sha || !existsSync(resolve(baseline.dist, 'esm-prod/Carburetor/index.mjs'))) {
    baseline = await prepareBaseline(reference);
    writeFileSync(manifestPath, JSON.stringify(baseline, null, 2) + '\n');
}
const amendments = JSON.parse(readFileSync(resolve('perf/ci/contract/gate-amendments.json'), 'utf8'));
const amendedGateFiles = [];
for (const [file, expected] of Object.entries(baseline.gateHashes)) {
    const actual = gateContractStatus(file, expected,
        hashGate(resolve('perf/gates', file)), amendments[file]?.sha256);
    if (actual.error) throw new Error(actual.error);
    if (actual.amended) amendedGateFiles.push({file, reason: amendments[file].reason});
}
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary && amendedGateFiles.length) appendFileSync(summary, '\n### Amended baseline gates\n\n' + amendedGateFiles.map(row => `- ${row.file}: ${row.reason}`).join('\n') + '\n');
writeFileSync(resolve(output, phase + '-environment.json'), JSON.stringify({phase, reference, baseline: sha,
    baselineEntries: baseline.entries.length, originalGateFiles: Object.keys(baseline.gateHashes).length,
    amendedGateFiles,
    distributionRoots: {baselineSource: baseline.sourceDist, baseline: baseline.dist, current: baseline.currentDist},
    currentCommit: process.env.GITHUB_SHA, node: process.version, platform: process.platform,
    architecture: process.arch, react, otherReact: JSON.parse(readFileSync(resolve(peer, 'node_modules/react/package.json'), 'utf8')).version,
    runner: process.env.RUNNER_NAME, runs}, null, 2) + '\n');
let accepted = true;
if (phase === 'current') {
    command('validate-complete-manifest', ['perf/run.mjs', '--lint-gates']);
    command('all-current-benchmark-entries', ['perf/run.mjs', '--dist', resolve(baseline.currentDist, 'esm-prod'),
        '--runs', String(runs), '--json', resolve(output, 'current-gates.json')]);
} else if (phase === 'previous') {
    const report = await comparePrevious(baseline, resolve(baseline.currentDist, 'esm-prod'), runs, resolve(output, 'previous-ab.json'));
    accepted = report.accepted;
} else if (phase === 'gains') {
    const report = await calibrateGains(baseline, resolve(output, 'mechanism-calibration.json'));
    accepted = report.accepted;
} else {
    const files = readdirSync('perf/gates').filter(file => file.endsWith('.mjs') && !Object.hasOwn(baseline.gateHashes, file)).sort();
    const report = await measureControls(baseline, files, runs, resolve(output, 'new-controls-ab.json'));
    if (report.entries === 0) throw new Error('No new completed-operation controls were selected');
    accepted = report.accepted;
}
console.log('CI RESULTS ' + output);
process.exitCode = accepted ? 0 : 1;
