/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// Compiles the `--init-classes` scaffold with the real Tailwind v4 compiler (CLS-11). The class
// rules only read stylesheets; this proves what they accept is a stylesheet Tailwind builds: custom
// utilities applied through other custom utilities, variants inside them, nested state blocks, and
// the `--color-*: initial` reset that removes the stock palette. Run from the repository root after
// `cargo build --release`; CI runs it in the Native linter job.
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Pinned exactly, like every dependency of the native crate: a compiler upgrade is a deliberate
// change to this file, not something a run picks up.
const TAILWIND = '4.3.5';

const name = process.platform === 'win32' ? 'carburetor-lint.exe' : 'carburetor-lint';
const binary = resolve('native', 'target', 'release', name);
const dir = mkdtempSync(join(tmpdir(), 'carburetor-tailwind-'));

const fail = (message, detail = '') => {
    console.error(`tailwind scaffold check failed: ${message}${detail ? `\n${detail}` : ''}`);
    process.exitCode = 1;
};

const run = (command, args, options = {}) =>
    spawnSync(command, args, {cwd: dir, encoding: 'utf8', shell: process.platform === 'win32', ...options});

try {
    const scaffold = run(binary, ['--init-classes', 'classes.css'], {shell: false});
    if (scaffold.status !== 0) throw new Error(`--init-classes exited ${scaffold.status}: ${scaffold.stderr}`);

    // The markup names a stock colour on purpose: after the reset it must produce nothing.
    writeFileSync(join(dir, 'markup.html'), [
        '<button class="submit-button">Save</button>',
        '<div class="status-badge bg-blue-600" data-status="success"></div>',
        '<section class="content-card"></section>',
        '',
    ].join('\n'));
    writeFileSync(join(dir, 'input.css'), [
        '@import "tailwindcss" source(none);',
        '@import "./classes.css";',
        '@source "./markup.html";',
        '',
    ].join('\n'));

    const install = run('npm', [
        'install', '--no-save', '--no-audit', '--no-fund', '--prefix', dir,
        `tailwindcss@${TAILWIND}`, `@tailwindcss/cli@${TAILWIND}`,
    ]);
    if (install.status !== 0) throw new Error(`npm install exited ${install.status}: ${install.stderr}`);

    const cli = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? 'tailwindcss.cmd' : 'tailwindcss');
    const build = run(cli, ['-i', 'input.css', '-o', 'out.css']);
    if (build.status !== 0) throw new Error(`tailwindcss exited ${build.status}: ${build.stderr}`);

    const css = readFileSync(join(dir, 'out.css'), 'utf8');
    const expectations = [
        ['.submit-button', true, 'the Function the markup uses'],
        ['.status-badge', true, 'a Function with state blocks'],
        ['[data-status="success"]', true, 'the state block selector'],
        ['var(--color-accent-fill)', true, 'a Tone painting with a Role'],
        ['--palette-blue-600', true, 'the Palette behind the Roles'],
        ['.bg-blue-600', false, 'a stock colour after the --color-* reset'],
    ];
    for (const [needle, present, what] of expectations) {
        if (css.includes(needle) !== present) {
            fail(`${what}: expected ${needle} to be ${present ? 'present' : 'absent'} in the output`);
        }
    }
    if (!process.exitCode) {
        console.log(`tailwind ${TAILWIND} compiled the class scaffold (${css.length} bytes)`);
    }
} catch (error) {
    fail(error.message);
} finally {
    rmSync(dir, {recursive: true, force: true});
}
