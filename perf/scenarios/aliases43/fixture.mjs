/* oxlint-disable carburetor-internal/max-line-length, carburetor-internal/require-tsdoc */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const root = resolve(process.env.DIST_ROOT ?? 'dist/esm-prod');
const require = createRequire(import.meta.url);
export const load = async () => {
    if (existsSync(resolve(root, 'Carburetor/index.mjs'))) {
        return import(pathToFileURL(resolve(root, 'Carburetor/index.mjs')).href);
    }
    assert.ok(existsSync(resolve(root, 'Carburetor/index.js')), 'missing distribution');
    return require(resolve(root, 'Carburetor/index.js'));
};
export {emit, median} from '../../harness/lib.mjs';
