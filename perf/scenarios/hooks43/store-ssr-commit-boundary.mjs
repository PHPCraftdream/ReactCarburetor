/* oxlint-disable carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dist, emit} from '../components43/fixture.mjs';
const version = process.argv[2] ?? '18';
const mode = process.argv[3] ?? 'plain';
const child = spawnSync(process.execPath,
    [fileURLToPath(new URL('./ssr-child.mjs', import.meta.url)), version, mode],
    {env: {...process.env, DIST_ROOT: dist, NODE_ENV: 'development'}, encoding: 'utf8'});
process.stderr.write(child.stderr ?? '');
assert.equal(child.status, 0, 'isolated server/fresh-client consumer child');
const line = child.stdout.split('\n').find(value => value.startsWith('@@ '));
assert.ok(line, 'child metrics');
emit(JSON.parse(line.slice(3)));
