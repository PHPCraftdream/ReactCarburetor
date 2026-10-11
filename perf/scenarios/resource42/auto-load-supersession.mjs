import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {emit} from '../../harness/lib.mjs';
const child = spawnSync(process.execPath, [fileURLToPath(new URL(
    '../../../__tests__/Engine/Resource/ResourceCache/Views/resource42/auto-load-child.mjs', import.meta.url))],
{env: {...process.env, NODE_ENV: 'development'}, encoding: 'utf8'});
if (child.status !== 0) {
    throw new Error('R42 resource owned load DOM/demand/global rejection failure: ' + child.stdout + child.stderr);
}
const line = child.stdout.split('\n').find(text => text.startsWith('@@ '));
if (!line) throw new Error('resource child did not complete its operations');
emit(JSON.parse(line.slice(3)));
