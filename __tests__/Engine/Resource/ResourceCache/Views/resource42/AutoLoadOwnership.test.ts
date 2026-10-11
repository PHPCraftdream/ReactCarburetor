import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';

describe('R42-R02 isolated Node automatic load ownership ' +
    '(requires npm run build; DIST_ROOT selects built distribution)', () => {
    test('SSR hydration delivers committed invalidation without recovery ' +
        '(REACT_ROOT selects React 18 consumer)', () => {
        const child = spawnSync(process.execPath, [
            resolve('__tests__/Engine/Resource/ResourceCache/Views/resource42/hydration-child.mjs'),
        ], {
            env: {...process.env, NODE_ENV: 'development'}, encoding: 'utf8',
        });
        expect({status: child.status, output: child.stdout + child.stderr}).toEqual({
            status: 0,
            output: expect.stringContaining('"hydrationDeliveries":1'),
        });
    });
    test('hook and class owned operations preserve explicit errors, consume only supersession, ' +
        'and expose unexpected errors', () => {
        const child = spawnSync(process.execPath, [
            resolve('__tests__/Engine/Resource/ResourceCache/Views/resource42/auto-load-child.mjs'),
        ], {
            env: {...process.env, NODE_ENV: 'development'}, encoding: 'utf8',
        });
        expect({status: child.status, output: child.stdout + child.stderr}).toEqual({
            status: 0,
            output: expect.stringContaining('"expectedGlobalRejections":0'),
        });
    });
});
