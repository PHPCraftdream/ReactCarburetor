import assert from 'node:assert/strict';
import {
    cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync,
    rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const worktree = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..');
const require = createRequire(import.meta.url);

/** Detects the selected bundle from actual files, never from a directory-name guess. */
export function bundleFormat(root) {
    if (existsSync(resolve(root, 'Carburetor/index.mjs'))) return 'esm';
    assert.ok(existsSync(resolve(root, 'Carburetor/index.js')), 'selected bundle must contain an ESM or CJS engine');
    return 'cjs';
}
/** Loads the actual selected format without changing the source distribution. */
export function importPart(root, part) {
    return bundleFormat(root) === 'cjs'
        ? Promise.resolve(require(resolve(root, part, 'index.js')))
        : import(pathToFileURL(resolve(root, part, 'index.mjs')).href);
}

/** Own ignored in-worktree fixture; never touches the parent repository's .rush. */
export function createFixture(label, modules = resolve(worktree, 'node_modules')) {
    const parent = resolve(worktree, '.consumer-matrix');
    mkdirSync(parent, {recursive: true});
    const root = mkdtempSync(resolve(parent, `r42-${label}-`));
    const link = resolve(root, 'node_modules');
    const target = realpathSync(modules);
    symlinkSync(target, link, 'junction');
    return {
        root,
        copy(source, name) {
            const destination = resolve(root, name);
            cpSync(source, destination, {recursive: true});
            writeFileSync(resolve(destination, 'package.json'), JSON.stringify({
                type: bundleFormat(destination) === 'cjs' ? 'commonjs' : 'module',
            }));
            return destination;
        },
        cleanup() {
            assert.ok(lstatSync(link).isSymbolicLink(), 'fixture node_modules must be our symlink/junction');
            assert.equal(realpathSync(link), target, 'fixture junction target must match the expected dependency root');
            unlinkSync(link); // Remove the junction itself BEFORE recursive fixture deletion.
            assert.equal(existsSync(link), false, 'junction must be gone before recursive removal');
            rmSync(root, {recursive: true, force: true});
        },
    };
}
