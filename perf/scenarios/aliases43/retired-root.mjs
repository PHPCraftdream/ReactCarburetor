/* oxlint-disable react/globals, carburetor/max-line-length, carburetor/require-tsdoc */
// This parent never imports the store. One bounded GC child per native kind, run serially.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emit, root} from './fixture.mjs';
const results = [];
for (const kind of ['date', 'map-member', 'opaque']) {
    const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(new URL('./retired-root-child.mjs', import.meta.url)), kind], {
        env: {...process.env, DIST_ROOT: root}, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const line = child.stdout.split(/\r?\n/).find(value => value.startsWith('@@ '));
    assert.ok(line, child.stdout);
    results.push(JSON.parse(line.slice(3)));
}
const controlsValid = results.every(value => value.controlsValid);
emit({cases: results.length, controlsValid, inconclusive: !controlsValid,
    cachedCollected: results.filter(value => value.cachedCollected).length,
    overwriteCollected: results.filter(value => value.overwriteCollected).length,
    ownersAlive: results.every(value => value.ownersAlive), results});
