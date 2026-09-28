import {mkdirSync, rmSync} from 'node:fs';
import path from 'node:path';
import {checkFormat, installConsumer} from './consumer-matrix/cell.mjs';
import {runDuplicateCheck} from './consumer-matrix/duplicateCheck.mjs';
import {runNextCheck} from './consumer-matrix/nextCheck.mjs';
import {MODULE_FORMATS, PACKAGE_MANAGERS, REACT_VERSIONS, REPO_ROOT, WORKDIR, run} from './consumer-matrix/matrix.mjs';

/**
 * Consumer matrix: installs the *packed tarball* — not repo source, not repo `dist/` —
 * into fresh npm/pnpm consumer projects across React majors and module formats, and runs a
 * real typecheck plus a real render against each, then builds a Next.js App Router app on it with
 * both bundlers to prove the `"use client"` boundary. `npm pack` and every install/build/run below
 * happen under `.consumer-matrix/` (gitignored); nothing here touches the worktree otherwise.
 *
 * tsc choice: the repo's own pinned TypeScript (not a consumer devDependency, so a per-cell
 * install would add an uncontrolled variable and a slow extra install) runs against a tsconfig
 * written into each cell's own directory — module resolution is relative to that file, so it
 * still resolves the cell's own installed react/@types/react-carburetor, not the repo's.
 */
const results = [];

const record = (cell, outcome) => {
    results.push({cell, ...outcome});
    const label = outcome.ok ? 'PASS' : (outcome.skip ? 'SKIP' : 'FAIL');
    console.log(`[${label}] ${cell}` + (outcome.stderr ? `\n  ${outcome.stderr.split('\n').slice(0, 8).join('\n  ')}` : ''));
};

console.log('Building the library and packing it...');
rmSync(WORKDIR, {recursive: true, force: true});
mkdirSync(WORKDIR, {recursive: true});

const build = run('npm', ['run', 'build'], {cwd: REPO_ROOT});

if (!build.ok) {
    console.error('npm run build failed:\n' + build.stdout + build.stderr);
    process.exit(1);
}

const pack = run('npm', ['pack', '--pack-destination', WORKDIR, '--json'], {cwd: REPO_ROOT});

if (!pack.ok) {
    console.error('npm pack failed:\n' + pack.stdout + pack.stderr);
    process.exit(1);
}

const [{filename}] = JSON.parse(pack.stdout);
const tarballPath = path.join(WORKDIR, filename);

console.log(`Packed ${filename}\n`);

let duplicateCheckDir;

for (const reactVersion of REACT_VERSIONS) {
    for (const packageManager of PACKAGE_MANAGERS) {
        const installDir = path.join(WORKDIR, `${reactVersion.id}-${packageManager}`);
        const install = installConsumer(installDir, reactVersion, packageManager, tarballPath);

        if (install.skip) {
            record(`${reactVersion.id}/${packageManager}/install`, {ok: false, skip: true, stderr: install.stderr});
            MODULE_FORMATS.forEach((format) => {
                record(`${reactVersion.id}/${packageManager}/${format}`, {ok: false, skip: true, stderr: 'install skipped'});
            });
            continue;
        }

        if (!install.ok) {
            const label = `${reactVersion.id}/${packageManager}/install`;

            record(label, {ok: false, stderr: install.stdout + install.stderr});
            MODULE_FORMATS.forEach((format) => {
                record(`${reactVersion.id}/${packageManager}/${format}`, {ok: false, stderr: 'install failed'});
            });
            continue;
        }

        record(`${reactVersion.id}/${packageManager}/install`, {ok: true});

        if (reactVersion.id === 'react19' && packageManager === 'npm') {
            duplicateCheckDir = installDir;
        }

        MODULE_FORMATS.forEach((format) => {
            record(`${reactVersion.id}/${packageManager}/${format}`, checkFormat(installDir, format));
        });
    }
}

if (duplicateCheckDir) {
    record('duplicate-copy diagnostic (react19/npm)', runDuplicateCheck(duplicateCheckDir));
} else {
    record('duplicate-copy diagnostic', {ok: false, skip: true, stderr: 'no successful install to run it against'});
}

runNextCheck(WORKDIR, tarballPath).forEach(({cell, ...outcome}) => record(cell, outcome));

const failed = results.filter((entry) => !entry.ok && !entry.skip);
const skipped = results.filter((entry) => entry.skip);

console.log(`\n${results.length} checks: ${results.length - failed.length - skipped.length} passed, `
    + `${skipped.length} skipped, ${failed.length} failed.`);

process.exit(failed.length > 0 ? 1 : 0);
