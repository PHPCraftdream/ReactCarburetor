/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Throughput scaling of the lint binary over generated nested-function files at 2k and 8k
// functions. The guard is the 8k/2k scale ratio (linear work is about 4x; the budget leaves a
// 3x noise margin), plus an exact diagnostics count as the correctness check, so a binary that
// stopped analyzing cannot look fast. A timing diagnostic is emitted but not gated.
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {emit} from '../../harness/lib.mjs';

const [count] = process.argv.slice(2).map(Number);

const name = process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint';
const binary = process.env.CARBURETOR_LINT_BIN
    ?? join('native', 'target', 'release', name);

// One nested function per call that uses nothing from its parent: the shape require-module-function
// reports, so the run's cost includes the capture analysis the rule is built from.
let source = '';
for (let index = 0; index < count; index++) {
    source += `export function f${index}(x: number) { return function () { return 1; }; }
`;
}

const dir = mkdtempSync(join(tmpdir(), 'lint-binary-gate-'));
writeFileSync(join(dir, 'generated.ts'), source);

const started = performance.now();
const result = spawnSync(binary, ['--rule', 'carburetor/require-module-function=error', '--format=json', dir],
    {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024});
const lintMs = performance.now() - started;

let found = -1;
if (result.status === 1) {
    try {
        found = JSON.parse(result.stdout).filter(item => item.rule === 'carburetor/require-module-function').length;
    } catch {
        found = -1;
    }
}

rmSync(dir, {recursive: true, force: true});

emit({lintMs, found, done: found === count});
