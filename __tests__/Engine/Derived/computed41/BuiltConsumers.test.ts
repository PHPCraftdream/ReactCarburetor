import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(resolve(process.cwd(), 'package.json'));

describe('R41 built public Computed consumers', () => {
    test('collision and external rollback work in both mixed-format directions', async () => {
        const helper = pathToFileURL(resolve(
            process.cwd(), 'scripts/consumer-matrix/round41/computed41Checks.mjs'
        )).href;
        const report = rstest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const {computed41Checks} = await import(helper);
            const esm = await import(pathToFileURL(resolve(process.cwd(), 'dist/esm/Carburetor/index.mjs')).href);
            const cjs = require(resolve(process.cwd(), 'dist/cjs/Carburetor/index.js'));
            computed41Checks(assert, esm, cjs, 'esm->cjs');
            computed41Checks(assert, cjs, esm, 'cjs->esm');
        } finally {
            report.mockRestore();
        }
    });
});
