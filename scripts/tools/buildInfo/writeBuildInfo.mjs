import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceHash} from './sourceHash.mjs';

/**
 * Writes deterministic build metadata to the checkout's dist directory.
 *
 * @param root Framework checkout root.
 */
export const writeBuildInfo = root => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const gitOptions = {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']};
    let commit;
    let shortCommit;
    let dirty = false;

    try {
        commit = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
        shortCommit = commit.slice(0, 12);
        dirty = execFileSync('git', ['status', '--porcelain'], gitOptions).trim().length > 0;
    } catch {}

    const info = {name: pkg.name, version: pkg.version, commit, shortCommit, dirty, sourceHash: sourceHash(root)};
    mkdirSync(join(root, 'dist'), {recursive: true});
    writeFileSync(join(root, 'dist', 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
};

const scriptRoot = fileURLToPath(new URL('../../..', import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    writeBuildInfo(resolve(process.argv[2] || scriptRoot));
}
