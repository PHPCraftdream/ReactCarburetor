/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
import {execFileSync} from 'node:child_process';
import {cpSync, readdirSync, rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {baselineDist} from '../../harness/baseline.mjs';
import {hashGateManifest} from './hashGate.mjs';

/** Builds the requested baseline and records its actual gate contracts before removing the metadata worktree. */
export const prepareBaseline = async reference => {
    const git = args => execFileSync('git', args, {encoding: 'utf8'}).trim();
    const sha = git(['rev-parse', '--verify', '--end-of-options', reference + '^{commit}']);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Baseline must resolve to a full commit SHA');
    const sourceDist = baselineDist(sha);
    const dist = resolve('worktrees/ci-comparison/baseline');
    const currentDist = resolve('worktrees/ci-comparison/modified');
    // Match root depth and length: relocation alone changed the measured JIT/startup cost.
    rmSync(dist, {recursive: true, force: true}); rmSync(currentDist, {recursive: true, force: true});
    cpSync(sourceDist, dist, {recursive: true});
    cpSync(resolve('dist'), currentDist, {recursive: true});
    const tree = resolve('worktrees', 'ci-gates-' + sha.slice(0, 12) + '-' + process.pid);
    const entries = [], gateHashes = {}, gateManifests = {};
    git(['worktree', 'add', '--detach', tree, sha]);
    try {
        for (const file of readdirSync(resolve(tree, 'perf/gates')).filter(file => file.endsWith('.mjs')).sort()) {
            const path = resolve(tree, 'perf/gates', file);
            const gates = (await import(pathToFileURL(path).href)).default;
            if (!Array.isArray(gates)) throw new Error('Invalid baseline manifest: ' + file);
            gateHashes[file] = hashGateManifest(gates); gateManifests[file] = gates;
            entries.push(...gates.map(entry => ({...entry, area: file.slice(0, -4)})));
        }
    } finally {git(['worktree', 'remove', '--force', tree]);}
    if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Duplicate baseline gate IDs');
    return {sha, sourceDist, dist, currentDist, entries, gateHashes, gateManifests};
};
