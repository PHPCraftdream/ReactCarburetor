/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {createRsbuild} from '@rsbuild/core';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Browser smoke is GitHub-only');
const chrome = process.env.CHROME_BIN;
if (!chrome || !existsSync(chrome)) throw new Error('CHROME_BIN must identify the installed hosted Chrome');
const output = resolve('worktrees/ci-results', process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT);
const bundle = resolve('worktrees', 'ci-browser-' + process.pid);
mkdirSync(output, {recursive: true});
const rsbuild = await createRsbuild({rsbuildConfig: {
    source: {entry: {index: resolve('perf/ci/smoke/browser-entry.mjs')}},
    output: {distPath: {root: bundle}},
    html: {title: 'R44 array delivery', mountId: 'app'},
}});
await rsbuild.build();
const types = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'};
const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const file = resolve(bundle, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(bundle + sep) || !existsSync(file)) {response.writeHead(404); response.end(); return;}
    response.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'});
    response.end(readFileSync(file));
});
await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
const url = 'http://127.0.0.1:' + server.address().port + '/';
const screenshot = resolve(output, 'browser.png');
const argv = ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + resolve(bundle, 'profile'), '--virtual-time-budget=5000', '--window-size=1000,720',
    '--screenshot=' + screenshot, '--dump-dom', url];
let stdout = '', stderr = '';
try {
    const result = await new Promise((resolveResult, reject) => {
        const child = spawn(chrome, argv, {stdio: ['ignore', 'pipe', 'pipe']});
        child.stdout.on('data', data => {stdout += data;});
        child.stderr.on('data', data => {stderr += data;});
        child.on('error', reject);
        const timer = setTimeout(() => child.kill(), 120000);
        child.on('close', (status, signal) => {clearTimeout(timer); resolveResult({status, signal});});
    });
    writeFileSync(resolve(output, 'browser-command.json'), JSON.stringify({chrome, argv, url, ...result, stdout, stderr}, null, 2) + '\n');
    writeFileSync(resolve(output, 'browser-dom.html'), stdout);
    assert.equal(result.status, 0, stderr); assert.equal(result.signal, null);
    assert.match(stdout, /<body[^>]*data-smoke="passed"/);
    for (const prototype of ['array', 'null', 'object']) for (const consumer of ['graph-hook', 'scalar-hook', 'graph-class', 'raw-class']) {
        assert.match(stdout, new RegExp('<output id="' + prototype + '-' + consumer + '">1</output>'));
    }
    const text = stdout.match(/<pre id="smoke-proof">([^<]+)<\/pre>/)?.[1];
    const proof = JSON.parse(text);
    assert.deepEqual(proof.errors, []);
    assert.ok(proof.proof.every(lane => lane.source === 1 && lane.deliveries === 1 && lane.outputs.every(value => value === '1')));
    assert.equal(proof.proof.length, 3);
    assert.ok(existsSync(screenshot), 'Chrome screenshot artifact');
    writeFileSync(resolve(output, 'browser-proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify({url, prototypes: 3, verifiedOutputs: 12, errors: proof.errors, screenshot, passed: true}));
} finally {await new Promise(resolveClosed => server.close(resolveClosed));}
