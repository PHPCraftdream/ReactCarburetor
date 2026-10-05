/* oxlint-disable react/globals, carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
// Builds the distribution of a git ref once and prints its directory, for A/B runs against the
// working tree: `node baseline.mjs <ref>` → worktrees/bench-dist/<sha>. Never installs anything:
// the temporary worktree lives under the repository, so the build resolves the repository's own
// node_modules. A cached build for the same commit is reused.
import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, rmSync} from 'node:fs';
import {join} from 'node:path';

const ref = process.argv[2];
if (!ref) throw new Error('usage: node baseline.mjs <git-ref>');

const git = (...args) => execFileSync('git', args, {encoding: 'utf8'}).trim();
const top = git('rev-parse', '--show-toplevel');
const sha = git('rev-parse', '--short=12', ref + '^{commit}');
const out = join(top, 'worktrees', 'bench-dist', sha);

if (!existsSync(join(out, 'esm-prod'))) {
    const build = join(top, 'worktrees', 'bench-build-' + sha);
    if (existsSync(build)) throw new Error(`${build} already exists; remove it first`);
    git('worktree', 'add', '--detach', build, sha);
    try {
        execFileSync(process.execPath, [join(top, 'node_modules', '@rslib', 'core', 'bin', 'rslib.js'), 'build'],
            {cwd: build, stdio: ['ignore', 'ignore', 'inherit']});
        rmSync(out, {recursive: true, force: true});
        cpSync(join(build, 'dist'), out, {recursive: true});
    } finally {
        git('worktree', 'remove', '--force', build);
    }
}
console.log(out);
