/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Packed lint smoke is GitHub-only');
const cwd = resolve('.consumer-matrix/react19-npm');
const require = createRequire(resolve(cwd, 'package.json'));
const preset = require.resolve('react-carburetor/lint/no-hooks.oxlintrc.json');
assert.ok(preset.replaceAll('\\', '/').startsWith(cwd.replaceAll('\\', '/') + '/node_modules/react-carburetor/dist/lint/'));
const native = resolve('native/target/release/carburetor-lint' + (process.platform === 'win32' ? '.exe' : ''));
assert.ok(existsSync(native), 'actual current release binary');
const output = resolve('worktrees/ci-results', process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT);
mkdirSync(output, {recursive: true});
copyFileSync('plugin/__fixtures__/consumer/noHooks.jsx', resolve(cwd, 'noHooks.jsx'));
writeFileSync(resolve(cwd, 'noHooks.oxlintrc.json'), JSON.stringify({extends: [preset]}) + '\n');
writeFileSync(resolve(cwd, 'noHooks.eslint.config.mjs'), `import carburetor from 'react-carburetor/lint';
export default [{...carburetor.configs['no-hooks'], files: ['**/*.jsx'], languageOptions: {
    ecmaVersion: 'latest', sourceType: 'module', parserOptions: {ecmaFeatures: {jsx: true}}
}}];\n`);
const rows = [];
function run(host, args, expectedStatus = 1) {
    const child = spawnSync(process.execPath, [resolve(host), ...args], {cwd,
        env: {...process.env, CARBURETOR_LINT_BIN: native}, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
    const row = {cwd, executable: process.execPath, argv: [resolve(host), ...args], preset, native,
        status: child.status, signal: child.signal, error: child.error?.message,
        stdout: child.stdout ?? '', stderr: child.stderr ?? ''};
    rows.push(row); writeFileSync(resolve(output, 'packed-lint-commands.json'), JSON.stringify({preset, rows}, null, 2) + '\n');
    assert.equal(child.status, expectedStatus, row.stdout + row.stderr); assert.equal(child.signal, null); assert.equal(child.error, undefined);
    return row.stdout;
}
const recommended = require.resolve('react-carburetor/lint/recommended.oxlintrc.json');
const allowed = run('node_modules/oxlint/bin/oxlint', ['-c', recommended, '--format', 'agent', 'noHooks.jsx'], 0);
assert.ok(!allowed.includes('carburetor(no-react-hooks-in-components)'));
const oxlint = run('node_modules/oxlint/bin/oxlint', ['-c', 'noHooks.oxlintrc.json', '--format', 'agent', 'noHooks.jsx']);
assert.deepEqual([...oxlint.matchAll(/noHooks\.jsx:(\d+):(\d+): error carburetor\(no-react-hooks-in-components\)/g)]
    .map(match => [Number(match[1]), Number(match[2])]), [[4, 21], [9, 5], [14, 16]]);
const eslint = JSON.parse(run('node_modules/eslint/bin/eslint.js', ['--no-warn-ignored', '--format', 'json', '-c', 'noHooks.eslint.config.mjs', 'noHooks.jsx']));
assert.deepEqual(eslint.flatMap(result => result.messages.map(message => [message.ruleId, message.severity, message.line, message.column])), [
    ['carburetor/no-react-hooks-in-components', 2, 4, 21],
    ['carburetor/no-react-hooks-in-components', 2, 9, 5],
    ['carburetor/no-react-hooks-in-components', 2, 14, 16],
]);
const manifest = JSON.parse(readFileSync(resolve(cwd, 'node_modules/react-carburetor/package.json'), 'utf8'));
const proof = {preset, hosts: 2, rejectedReactCallsPerHost: 3, recommendedAllowsReactHooks: true,
    version: manifest.version, native, passed: true};
writeFileSync(resolve(output, 'packed-lint-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log(JSON.stringify(proof));
